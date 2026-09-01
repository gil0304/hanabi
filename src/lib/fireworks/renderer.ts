import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { BackgroundMode, FireworkRecord } from "@/types";
import type {
  CreateFireworksRenderer,
  FireworksRenderer,
  FireworksRendererEvents,
  LaunchOptions,
} from "./types";
import { Background } from "./background";
import { FireworkSlot, type SharedFx } from "./fireworkInstance";
import type { PixelScaleUniform } from "./shaders";
import { createParticleMaterial } from "./shaders";
import { SmokePool } from "./smoke";
import {
  createFlashTexture,
  createGlowTexture,
  createSmokeTexture,
} from "./textures";

/** 同時 5 発以上をプールで支える */
const SLOT_COUNT = 6;
const MAX_QUEUE = 40;
const MAX_PIXEL_RATIO = 1.75;
const FOV = 50;

interface QueuedLaunch {
  record: FireworkRecord;
  opts?: LaunchOptions;
}

class FireworksRendererImpl implements FireworksRenderer {
  private events: FireworksRendererEvents;
  private mode: BackgroundMode = "festival";
  private queue: QueuedLaunch[] = [];
  private disposed = false;
  private mounted = false;

  private container: HTMLElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private background: Background | null = null;
  private smoke: SmokePool | null = null;
  private slots: FireworkSlot[] = [];
  private reflectionGroup: THREE.Group | null = null;
  private materials: THREE.ShaderMaterial[] = [];
  private textures: THREE.Texture[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private raf = 0;
  private clock: THREE.Clock | null = null;
  private time = 0;
  private pixelScale: PixelScaleUniform = { value: 1000 };
  private fx: SharedFx = { exposurePulse: 0 };

  constructor(events?: FireworksRendererEvents) {
    this.events = events ?? {};
  }

  mount(container: HTMLElement): void {
    if (this.mounted || this.disposed) return;
    this.mounted = true;
    this.container = container;

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.setClearColor(0x04051a, 1);
    const canvas = renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 300);
    camera.position.set(0, 4.5, 14);
    camera.lookAt(0, 4.5, 0);
    this.camera = camera;

    const glowTex = createGlowTexture();
    const flashTex = createFlashTexture();
    const smokeTex = createSmokeTexture();
    this.textures.push(glowTex, flashTex, smokeTex);

    const mainMaterial = createParticleMaterial(
      glowTex,
      this.pixelScale,
      1,
      new THREE.Color(1, 1, 1),
    );
    // 水面反射: 薄く・わずかに青く
    const reflMaterial = createParticleMaterial(
      glowTex,
      this.pixelScale,
      0.14,
      new THREE.Color(0.6, 0.75, 1.0),
    );
    this.materials.push(mainMaterial, reflMaterial);

    const background = new Background(renderer.getPixelRatio());
    scene.add(background.group);
    this.background = background;

    const smoke = new SmokePool(smokeTex);
    scene.add(smoke.group);
    this.smoke = smoke;

    const fireworksGroup = new THREE.Group();
    const reflectionGroup = new THREE.Group();
    reflectionGroup.scale.set(1, -1, 1);
    this.reflectionGroup = reflectionGroup;

    const onFree = (): void => this.flushQueue();
    for (let i = 0; i < SLOT_COUNT; i++) {
      const slot = new FireworkSlot({
        particleMaterial: mainMaterial,
        flashTexture: flashTex,
        events: this.events,
        fx: this.fx,
        smoke,
        onFree,
      });
      this.slots.push(slot);
      fireworksGroup.add(slot.points, slot.trailPoints, slot.flash);
      // ジオメトリを共有して y 反転描画するだけの安価な水面反射
      const refl = new THREE.Points(slot.geometry, reflMaterial);
      refl.frustumCulled = false;
      reflectionGroup.add(refl);
    }
    scene.add(fireworksGroup, reflectionGroup);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.15, 0.65, 0.15);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.bloomPass = bloom;

    this.applyMode();
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.clock = new THREE.Clock();
    this.raf = requestAnimationFrame(this.tick);
    this.flushQueue();
  }

  launch(record: FireworkRecord, opts?: LaunchOptions): void {
    if (this.disposed) return;
    if (this.queue.length >= MAX_QUEUE) this.queue.shift();
    this.queue.push({ record, opts });
    this.flushQueue();
  }

  activeCount(): number {
    let n = 0;
    for (const s of this.slots) if (s.phase !== "idle") n++;
    return n;
  }

  setBackgroundMode(mode: BackgroundMode): void {
    this.mode = mode;
    this.applyMode();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const s of this.slots) s.dispose();
    this.slots = [];
    // 反射 Points はスロットとジオメトリ/マテリアルを共有しているため個別 dispose は不要
    this.background?.dispose();
    this.smoke?.dispose();
    for (const m of this.materials) m.dispose();
    this.materials = [];
    for (const t of this.textures) t.dispose();
    this.textures = [];
    // composer.dispose() はパス自体の GPU リソースまでは解放しない
    this.bloomPass?.dispose();
    this.bloomPass = null;
    this.composer?.dispose();
    if (this.renderer) {
      const canvas = this.renderer.domElement;
      this.renderer.dispose();
      canvas.parentElement?.removeChild(canvas);
    }
    this.renderer = null;
    this.scene = null;
    this.composer = null;
    this.container = null;
    this.queue = [];
  }

  // ------------------------------------------------------------------

  private flushQueue(): void {
    if (!this.mounted || this.disposed) return;
    while (this.queue.length > 0) {
      const free = this.slots.find((s) => s.isFree());
      if (!free) return;
      const job = this.queue.shift();
      if (!job) return;
      free.start(job.record, job.opts);
    }
  }

  private applyMode(): void {
    this.background?.setMode(this.mode);
    if (this.reflectionGroup) {
      this.reflectionGroup.visible = this.mode === "festival";
    }
  }

  private resize(): void {
    if (!this.renderer || !this.camera || !this.composer || !this.container) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
    this.bloomPass?.setSize(w, h);
    // gl_PointSize はデバイスピクセル基準
    const bufH = h * this.renderer.getPixelRatio();
    this.pixelScale.value = bufH / (2 * Math.tan((FOV * Math.PI) / 360));
  }

  private tick = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const clock = this.clock;
    const renderer = this.renderer;
    const composer = this.composer;
    if (!clock || !renderer || !composer) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    this.time += dt;

    this.background?.update(dt, this.time);
    this.smoke?.update(dt);
    for (const s of this.slots) s.update(dt);

    // 爆発時の露出パルス (減衰)
    this.fx.exposurePulse *= Math.exp(-dt * 5.5);
    renderer.toneMappingExposure = 1 + this.fx.exposurePulse;

    composer.render();
  };
}

export const createFireworksRenderer: CreateFireworksRenderer = (events) =>
  new FireworksRendererImpl(events);
