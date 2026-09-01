import * as THREE from "three";
import type { FireworkRecord } from "@/types";
import type { FireworksRendererEvents, LaunchHeight, LaunchOptions } from "./types";
import { TAU, clamp, lerp, pick, rand } from "./math";
import { sampleDrawing } from "./sampling";
import type { SmokePool } from "./smoke";

/**
 * 1 スロット = 1 発の花火。バッファは全て起動時に確保し、ホットループでは割り当てゼロ。
 * 粒子は固定領域レイアウト: [頭] [上昇火花] [形状粒子] [火の粉]
 */

const SHAPE_CAP = 1500;
const SPARK_CAP = 100;
const RISE_CAP = 90;
const HEAD = 0;
const RISE_START = 1;
const SHAPE_START = RISE_START + RISE_CAP;
const SPARK_START = SHAPE_START + SHAPE_CAP;
const MAIN_CAP = SPARK_START + SPARK_CAP;

const TRAIL_ITEMS = SHAPE_CAP + SPARK_CAP;
/** 履歴リング: 現在位置 + 残像6 */
const HIST_LEN = 7;
const GHOSTS = HIST_LEN - 1;
const TRAIL_CAP = TRAIL_ITEMS * GHOSTS;

/** v *= e^{-k·dt}。0=形状 (0.90^(60dt) 相当 → 半径×k で目標へ漸近収束), 1=火の粉, 2=上昇火花 */
const DRAG_K: [number, number, number] = [6.32, 1.6, 4.5];
const WHITE_HOT = 0.18;
const GRAVITY = 0.55;
const FLASH_DUR = 0.15;

const HEIGHTS: Record<LaunchHeight, [number, number]> = {
  low: [5.5, 6.3],
  medium: [6.6, 7.6],
  high: [7.8, 8.5],
};
const HEIGHT_KEYS: LaunchHeight[] = ["low", "medium", "high"];
const LAUNCH_ZONES = [-3.8, 0, 3.8];

export interface SharedFx {
  /** 爆発時の露出パルス (renderer が毎フレーム減衰させる) */
  exposurePulse: number;
}

export interface SlotDeps {
  particleMaterial: THREE.ShaderMaterial;
  flashTexture: THREE.Texture;
  events: FireworksRendererEvents;
  fx: SharedFx;
  smoke: SmokePool;
  /** スロットが空いたとき (キュー消化用) */
  onFree: () => void;
}

export type SlotPhase = "idle" | "rising" | "burst";

export class FireworkSlot {
  readonly geometry: THREE.BufferGeometry;
  readonly trailGeometry: THREE.BufferGeometry;
  readonly points: THREE.Points;
  readonly trailPoints: THREE.Points;
  readonly flash: THREE.Sprite;
  phase: SlotPhase = "idle";

  private deps: SlotDeps;
  private record: FireworkRecord | null = null;

  // ---- GPU 属性 ----
  private positions = new Float32Array(MAIN_CAP * 3);
  private colors = new Float32Array(MAIN_CAP * 3);
  private sizes = new Float32Array(MAIN_CAP);
  private alphas = new Float32Array(MAIN_CAP);
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;

  private trailPositions = new Float32Array(TRAIL_CAP * 3);
  private trailColors = new Float32Array(TRAIL_CAP * 3);
  private trailSizes = new Float32Array(TRAIL_CAP);
  private trailAlphas = new Float32Array(TRAIL_CAP);
  private trailPosAttr: THREE.BufferAttribute;
  private trailColAttr: THREE.BufferAttribute;
  private trailSizeAttr: THREE.BufferAttribute;
  private trailAlphaAttr: THREE.BufferAttribute;

  // ---- シミュレーション状態 ----
  private vel = new Float32Array(MAIN_CAP * 3);
  private baseCol = new Float32Array(MAIN_CAP * 3);
  private ages = new Float32Array(MAIN_CAP);
  private life = new Float32Array(MAIN_CAP);
  private grav = new Float32Array(MAIN_CAP);
  private flick = new Float32Array(MAIN_CAP * 2);
  private dragClass = new Uint8Array(MAIN_CAP);
  private alive = new Uint8Array(MAIN_CAP);
  private hist = new Float32Array(TRAIL_ITEMS * HIST_LEN * 3);

  private targets = new Float32Array(SHAPE_CAP * 3);
  private targetColors = new Float32Array(SHAPE_CAP * 3);

  // ホットループ用の使い回しバッファ (毎フレーム割り当てない)
  private dampTmp = new Float32Array(3);
  private histSlot = new Int32Array(HIST_LEN);

  // ---- 打ち上げごとのパラメータ ----
  private launchX = 0;
  private baseZ = 0;
  private burstY = 7;
  private radius = 2.3;
  private riseDur = 2;
  private riseT = 0;
  private wigglePhase = 0;
  private headVy = 0;
  private prevHeadY = 0;
  private emitAcc = 0;
  private smokeAcc = 0;
  private riseCursor = 0;
  private shapeCount = 0;
  private sparkCount = 0;
  private burstAge = 0;
  private ringHead = 0;
  private crackleDone = false;
  private flashAge = 0;
  private flashMat: THREE.SpriteMaterial;
  private aliveNow = 0;
  private needColors = false;
  private needTrailStatic = false;

  constructor(deps: SlotDeps) {
    this.deps = deps;

    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.colAttr = new THREE.BufferAttribute(this.colors, 3);
    this.sizeAttr = new THREE.BufferAttribute(this.sizes, 1);
    this.alphaAttr = new THREE.BufferAttribute(this.alphas, 1);
    for (const a of [this.posAttr, this.colAttr, this.sizeAttr, this.alphaAttr]) {
      a.setUsage(THREE.DynamicDrawUsage);
    }
    this.geometry.setAttribute("position", this.posAttr);
    this.geometry.setAttribute("aColor", this.colAttr);
    this.geometry.setAttribute("aSize", this.sizeAttr);
    this.geometry.setAttribute("aAlpha", this.alphaAttr);
    this.geometry.setDrawRange(0, 0);
    this.points = new THREE.Points(this.geometry, deps.particleMaterial);
    this.points.frustumCulled = false;

    this.trailGeometry = new THREE.BufferGeometry();
    this.trailPosAttr = new THREE.BufferAttribute(this.trailPositions, 3);
    this.trailColAttr = new THREE.BufferAttribute(this.trailColors, 3);
    this.trailSizeAttr = new THREE.BufferAttribute(this.trailSizes, 1);
    this.trailAlphaAttr = new THREE.BufferAttribute(this.trailAlphas, 1);
    for (const a of [
      this.trailPosAttr,
      this.trailColAttr,
      this.trailSizeAttr,
      this.trailAlphaAttr,
    ]) {
      a.setUsage(THREE.DynamicDrawUsage);
    }
    this.trailGeometry.setAttribute("position", this.trailPosAttr);
    this.trailGeometry.setAttribute("aColor", this.trailColAttr);
    this.trailGeometry.setAttribute("aSize", this.trailSizeAttr);
    this.trailGeometry.setAttribute("aAlpha", this.trailAlphaAttr);
    this.trailGeometry.setDrawRange(0, 0);
    this.trailPoints = new THREE.Points(this.trailGeometry, deps.particleMaterial);
    this.trailPoints.frustumCulled = false;

    this.flashMat = new THREE.SpriteMaterial({
      map: deps.flashTexture,
      color: 0xfff2dd,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.flash = new THREE.Sprite(this.flashMat);
    this.flash.visible = false;
    this.flash.frustumCulled = false;
  }

  isFree(): boolean {
    return this.phase === "idle";
  }

  start(record: FireworkRecord, opts?: LaunchOptions): void {
    this.record = record;
    this.phase = "rising";
    this.launchX =
      opts?.x !== undefined
        ? clamp(opts.x, 0, 1) * 12 - 6
        : clamp(pick(LAUNCH_ZONES) + rand(-1.6, 1.6), -6, 6);
    this.baseZ = rand(-0.8, 0.8);
    const h = opts?.height ?? pick(HEIGHT_KEYS);
    const range = HEIGHTS[h];
    this.burstY = rand(range[0], range[1]);
    this.radius = rand(2.1, 2.6);
    this.riseDur = rand(1.5, 2.5);
    this.riseT = 0;
    this.wigglePhase = rand(0, TAU);
    this.prevHeadY = 0;
    this.headVy = 0;
    this.emitAcc = 0;
    this.smokeAcc = 0;
    this.riseCursor = 0;
    // 爆発フレームのヒッチ回避のため、サンプリングは打ち上げ時に済ませる
    this.shapeCount = sampleDrawing(
      record.drawing_data,
      this.radius,
      this.targets,
      this.targetColors,
      SHAPE_CAP,
    );
    this.alive.fill(0);
    this.alphas.fill(0);
    this.trailAlphas.fill(0);

    this.positions[0] = this.launchX;
    this.positions[1] = 0;
    this.positions[2] = this.baseZ;
    this.colors[0] = 1.5;
    this.colors[1] = 1.05;
    this.colors[2] = 0.55;
    this.sizes[HEAD] = 0.085;
    this.alphas[HEAD] = 1;
    this.needColors = true;

    this.geometry.setDrawRange(0, SHAPE_START);
    this.trailGeometry.setDrawRange(0, 0);
    this.deps.events.onLaunch?.();
  }

  update(dt: number): void {
    if (this.phase === "idle") return;
    if (this.phase === "rising") this.updateRise(dt);
    if (this.phase === "burst") this.updateBurstFrame(dt);
    this.updateParticles(dt);
    this.commit();
    if (this.phase === "burst" && this.aliveNow === 0 && !this.flash.visible) {
      this.finish();
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.trailGeometry.dispose();
    this.flashMat.dispose();
  }

  // ---------------------------------------------------------------- rising

  private updateRise(dt: number): void {
    this.riseT += dt;
    const u = Math.min(this.riseT / this.riseDur, 1);
    // 出だし速く、頂点に向けて減速 (完全停止はさせない)
    const ease = 1 - Math.pow(1 - u, 2.2);
    const y = this.burstY * (0.12 * u + 0.88 * ease);
    const wig = Math.sin(this.riseT * 7 + this.wigglePhase) * 0.07 * (0.4 + 0.6 * u);
    this.positions[0] = this.launchX + wig;
    this.positions[1] = y;
    this.positions[2] = this.baseZ;
    this.headVy = dt > 0 ? (y - this.prevHeadY) / dt : 0;
    this.prevHeadY = y;
    this.alphas[HEAD] = 0.85 + 0.25 * Math.sin(this.riseT * 31 + this.wigglePhase);

    this.emitAcc += dt;
    while (this.emitAcc > 0.022) {
      this.emitAcc -= 0.022;
      this.spawnRiseSpark();
    }
    this.smokeAcc += dt;
    if (this.smokeAcc > 0.3) {
      this.smokeAcc = 0;
      this.deps.smoke.hint(this.positions[0], y, this.baseZ);
    }
    if (u >= 1) this.burst();
  }

  private spawnRiseSpark(): void {
    const idx = RISE_START + (this.riseCursor++ % RISE_CAP);
    const i3 = idx * 3;
    this.positions[i3] = this.positions[0] + rand(-0.05, 0.05);
    this.positions[i3 + 1] = this.positions[1] + rand(-0.06, 0.02);
    this.positions[i3 + 2] = this.positions[2] + rand(-0.05, 0.05);
    this.vel[i3] = rand(-0.35, 0.35);
    this.vel[i3 + 1] = this.headVy * rand(0.05, 0.3) - rand(0, 0.3);
    this.vel[i3 + 2] = rand(-0.35, 0.35);
    const b = rand(0.75, 1.2);
    this.baseCol[i3] = b;
    this.baseCol[i3 + 1] = 0.68 * b;
    this.baseCol[i3 + 2] = 0.32 * b;
    this.colors[i3] = this.baseCol[i3];
    this.colors[i3 + 1] = this.baseCol[i3 + 1];
    this.colors[i3 + 2] = this.baseCol[i3 + 2];
    this.sizes[idx] = rand(0.024, 0.04);
    this.alphas[idx] = 1;
    this.ages[idx] = 0;
    this.life[idx] = rand(0.25, 0.6);
    this.grav[idx] = 0.5;
    this.dragClass[idx] = 2;
    this.flick[idx * 2] = rand(0, TAU);
    this.flick[idx * 2 + 1] = rand(12, 24);
    this.alive[idx] = 1;
    this.needColors = true;
  }

  // ---------------------------------------------------------------- burst

  private burst(): void {
    this.phase = "burst";
    this.burstAge = 0;
    this.ringHead = 0;
    this.crackleDone = false;
    const cx = this.positions[0];
    const cy = this.positions[1];
    const cz = this.positions[2];
    this.alphas[HEAD] = 0;

    // 形状粒子: 中心から目標へ。初速 = 距離×k なので減衰と釣り合い ~1s で形に到達する
    for (let i = 0; i < this.shapeCount; i++) {
      const idx = SHAPE_START + i;
      const i3 = idx * 3;
      const t3 = i * 3;
      const ox = this.targets[t3];
      const oy = this.targets[t3 + 1];
      const oz = this.targets[t3 + 2];
      let dist = Math.sqrt(ox * ox + oy * oy + oz * oz);
      if (dist < 1e-4) dist = 1e-4;
      const v0 = dist * DRAG_K[0] * rand(0.94, 1.06);
      this.vel[i3] = (ox / dist) * v0;
      this.vel[i3 + 1] = (oy / dist) * v0;
      this.vel[i3 + 2] = (oz / dist) * v0;
      // 全粒子を厳密に同一点から出すと加算で1pxが超HDR値になり
      // Bloom の分離ブラーが矩形に飽和する。ごく小さく散らして開始する
      const s0 = rand(0.05, 0.16);
      this.positions[i3] = cx + ox * s0;
      this.positions[i3 + 1] = cy + oy * s0;
      this.positions[i3 + 2] = cz + oz * s0;
      this.baseCol[i3] = this.targetColors[t3];
      this.baseCol[i3 + 1] = this.targetColors[t3 + 1];
      this.baseCol[i3 + 2] = this.targetColors[t3 + 2];
      this.colors[i3] = 1.7;
      this.colors[i3 + 1] = 1.62;
      this.colors[i3 + 2] = 1.45;
      this.sizes[idx] = rand(0.06, 0.085);
      this.alphas[idx] = 1;
      this.ages[idx] = 0;
      this.life[idx] = rand(1.6, 2.8);
      this.grav[idx] = GRAVITY * rand(0.8, 1.2);
      this.dragClass[idx] = 0;
      this.flick[idx * 2] = rand(0, TAU);
      this.flick[idx * 2 + 1] = rand(6, 14);
      this.alive[idx] = 1;
      this.initTrail(idx, cx, cy, cz);
    }

    // 火の粉: 球面ランダム・強め重力・長い明滅
    this.sparkCount = Math.round(lerp(20, 100, this.shapeCount / SHAPE_CAP));
    for (let i = 0; i < this.sparkCount; i++) {
      const idx = SPARK_START + i;
      const i3 = idx * 3;
      const uy = rand(-1, 1);
      const az = rand(0, TAU);
      const rr = Math.sqrt(Math.max(0, 1 - uy * uy));
      const speed = rand(1.6, 4.6);
      this.vel[i3] = rr * Math.cos(az) * speed;
      this.vel[i3 + 1] = uy * speed;
      this.vel[i3 + 2] = rr * Math.sin(az) * speed;
      this.positions[i3] = cx + this.vel[i3] * 0.02;
      this.positions[i3 + 1] = cy + this.vel[i3 + 1] * 0.02;
      this.positions[i3 + 2] = cz + this.vel[i3 + 2] * 0.02;
      const b = rand(0.8, 1.15);
      this.baseCol[i3] = b;
      this.baseCol[i3 + 1] = rand(0.55, 0.78) * b;
      this.baseCol[i3 + 2] = rand(0.14, 0.3) * b;
      this.colors[i3] = this.baseCol[i3];
      this.colors[i3 + 1] = this.baseCol[i3 + 1];
      this.colors[i3 + 2] = this.baseCol[i3 + 2];
      this.sizes[idx] = rand(0.034, 0.052);
      this.alphas[idx] = 1;
      this.ages[idx] = 0;
      this.life[idx] = rand(2.2, 3.4);
      this.grav[idx] = GRAVITY * rand(1.5, 2.0);
      this.dragClass[idx] = 1;
      this.flick[idx * 2] = rand(0, TAU);
      this.flick[idx * 2 + 1] = rand(9, 18);
      this.alive[idx] = 1;
      this.initTrail(idx, cx, cy, cz);
    }

    this.geometry.setDrawRange(0, MAIN_CAP);
    this.trailGeometry.setDrawRange(0, TRAIL_CAP);
    this.needColors = true;
    this.needTrailStatic = true;

    this.flashAge = 0;
    this.flash.visible = true;
    this.flash.position.set(cx, cy, cz);
    this.flash.scale.set(0.6, 0.6, 1);
    this.flashMat.opacity = 0.9;
    this.deps.fx.exposurePulse = Math.min(this.deps.fx.exposurePulse + 0.35, 0.8);
    this.deps.smoke.burst(cx, cy, cz);
    this.deps.events.onBurst?.(this.shapeCount / SHAPE_CAP);
  }

  private initTrail(idx: number, cx: number, cy: number, cz: number): void {
    const ti = idx - SHAPE_START;
    for (let s = 0; s < HIST_LEN; s++) {
      const hb = (ti * HIST_LEN + s) * 3;
      this.hist[hb] = cx;
      this.hist[hb + 1] = cy;
      this.hist[hb + 2] = cz;
    }
    const i3 = idx * 3;
    const size = this.sizes[idx];
    for (let j = 1; j <= GHOSTS; j++) {
      const g = ti * GHOSTS + j - 1;
      const g3 = g * 3;
      this.trailSizes[g] = size * (1 - 0.11 * j);
      this.trailColors[g3] = this.baseCol[i3] * 0.85;
      this.trailColors[g3 + 1] = this.baseCol[i3 + 1] * 0.85;
      this.trailColors[g3 + 2] = this.baseCol[i3 + 2] * 0.85;
      this.trailPositions[g3] = cx;
      this.trailPositions[g3 + 1] = cy;
      this.trailPositions[g3 + 2] = cz;
      this.trailAlphas[g] = 0;
    }
  }

  private updateBurstFrame(dt: number): void {
    this.burstAge += dt;
    if (!this.crackleDone && this.burstAge >= 0.4) {
      this.crackleDone = true;
      this.deps.events.onCrackle?.();
    }
    if (this.flash.visible) {
      this.flashAge += dt;
      const ft = this.flashAge / FLASH_DUR;
      if (ft >= 1) {
        this.flash.visible = false;
        this.flashMat.opacity = 0;
      } else {
        const s = lerp(0.6, 3.4, ft);
        this.flash.scale.set(s, s, 1);
        this.flashMat.opacity = 0.9 * (1 - ft) * (1 - ft);
      }
    }
    // 残像リングを 1 進め、j フレーム前のスロット番号を先に引いておく
    this.ringHead = (this.ringHead + 1) % HIST_LEN;
    for (let j = 0; j < HIST_LEN; j++) {
      this.histSlot[j] = (this.ringHead - j + HIST_LEN) % HIST_LEN;
    }
  }

  // ---------------------------------------------------------------- hot loop

  private updateParticles(dt: number): void {
    const end = this.phase === "rising" ? SHAPE_START : MAIN_CAP;
    const inBurst = this.phase === "burst";
    this.dampTmp[0] = Math.exp(-DRAG_K[0] * dt);
    this.dampTmp[1] = Math.exp(-DRAG_K[1] * dt);
    this.dampTmp[2] = Math.exp(-DRAG_K[2] * dt);
    const {
      positions,
      colors,
      alphas,
      vel,
      baseCol,
      ages,
      life,
      grav,
      flick,
      dragClass,
      alive,
      hist,
      trailPositions,
      trailAlphas,
      histSlot,
      dampTmp,
    } = this;

    let count = 0;
    for (let i = RISE_START; i < end; i++) {
      if (alive[i] === 0) continue;
      const age = ages[i] + dt;
      ages[i] = age;
      if (age >= life[i]) {
        this.kill(i);
        continue;
      }
      count++;
      const i3 = i * 3;
      const d = dampTmp[dragClass[i]];
      let vx = vel[i3] * d;
      let vy = vel[i3 + 1] * d;
      let vz = vel[i3 + 2] * d;
      // 重力は ~0.9s かけて効かせ、展開直後の形を保つ
      vy -= grav[i] * Math.min(age * 1.11, 1) * dt;
      vel[i3] = vx;
      vel[i3 + 1] = vy;
      vel[i3 + 2] = vz;
      const px = positions[i3] + vx * dt;
      const py = positions[i3 + 1] + vy * dt;
      const pz = positions[i3 + 2] + vz * dt;
      positions[i3] = px;
      positions[i3 + 1] = py;
      positions[i3 + 2] = pz;

      const fSpeed = flick[i * 2 + 1];
      let fl = 0.72 + 0.28 * Math.sin(flick[i * 2] + age * fSpeed);
      // 時折のドロップアウト
      if (Math.sin(flick[i * 2] * 1.93 + age * fSpeed * 1.31) > 0.965) fl *= 0.15;
      const rem = 1 - age / life[i];
      // 出現直後は密集しているため α をランプインして加算輝度の暴発を防ぐ
      // (フラッシュが重なる時間帯なので見た目には気付かれない)
      const rampIn = Math.min(age * 5.5, 1);
      const alpha = rem * Math.sqrt(rem) * fl * rampIn;
      alphas[i] = alpha;

      const isTrailed = i >= SHAPE_START;
      // 爆発直後 180ms は白熱 → ストローク色へ
      if (isTrailed && age < WHITE_HOT + 0.04) {
        const w = age < WHITE_HOT ? 1 - age / WHITE_HOT : 0;
        colors[i3] = baseCol[i3] + (1.7 - baseCol[i3]) * w;
        colors[i3 + 1] = baseCol[i3 + 1] + (1.62 - baseCol[i3 + 1]) * w;
        colors[i3 + 2] = baseCol[i3 + 2] + (1.45 - baseCol[i3 + 2]) * w;
        this.needColors = true;
      }

      // 残像: 速度に比例して濃くなる → 展開の一瞬が最も強く、漂いでは控えめ (仕様 §26)
      if (isTrailed && inBurst) {
        const ti = i - SHAPE_START;
        const hb = (ti * HIST_LEN + histSlot[0]) * 3;
        hist[hb] = px;
        hist[hb + 1] = py;
        hist[hb + 2] = pz;
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        const ta = alpha * Math.min(speed * 0.16, 1) * 0.6;
        const gb = ti * GHOSTS;
        for (let j = 1; j <= GHOSTS; j++) {
          const hs = (ti * HIST_LEN + histSlot[j]) * 3;
          const g = gb + j - 1;
          const g3 = g * 3;
          trailPositions[g3] = hist[hs];
          trailPositions[g3 + 1] = hist[hs + 1];
          trailPositions[g3 + 2] = hist[hs + 2];
          trailAlphas[g] = ta * (1 - j / (GHOSTS + 1));
        }
      }
    }
    this.aliveNow = count;
  }

  private kill(i: number): void {
    this.alive[i] = 0;
    this.alphas[i] = 0;
    if (i >= SHAPE_START) {
      const gb = (i - SHAPE_START) * GHOSTS;
      for (let j = 0; j < GHOSTS; j++) this.trailAlphas[gb + j] = 0;
    }
  }

  private commit(): void {
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    if (this.needColors) {
      this.colAttr.needsUpdate = true;
      this.needColors = false;
    }
    if (this.phase === "burst") {
      this.trailPosAttr.needsUpdate = true;
      this.trailAlphaAttr.needsUpdate = true;
      if (this.needTrailStatic) {
        this.trailSizeAttr.needsUpdate = true;
        this.trailColAttr.needsUpdate = true;
        this.needTrailStatic = false;
      }
    }
  }

  private finish(): void {
    this.phase = "idle";
    this.geometry.setDrawRange(0, 0);
    this.trailGeometry.setDrawRange(0, 0);
    const rec = this.record;
    this.record = null;
    if (rec) this.deps.events.onFireworkEnd?.(rec);
    this.deps.onFree();
  }
}
