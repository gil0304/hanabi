import * as THREE from "three";
import type { BackgroundMode } from "@/types";
import { TAU, rand } from "./math";
import { createCloudTexture } from "./textures";

/**
 * 夜景背景 (仕様 §17: 単なる黒背景禁止 / ただし花火より目立たないこと)。
 * minimal モード: 空グラデ + 星のみ。festival: 山・鳥居・雲・水面・観客も表示。
 */

const SKY_VERT = /* glsl */ `
varying float vY;
void main() {
  vY = (modelMatrix * vec4(position, 1.0)).y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
varying float vY;
void main() {
  float t = clamp((vY + 6.0) / 44.0, 0.0, 1.0);
  vec3 col = mix(uMid, uZenith, smoothstep(0.16, 0.8, t));
  float h = 1.0 - smoothstep(0.0, 0.2, t);
  col = mix(col, uHorizon, h * 0.55);
  gl_FragColor = vec4(col, 1.0);
}
`;

const STAR_VERT = /* glsl */ `
attribute float aPhase;
attribute float aSize;
uniform float uTime;
uniform float uDpr;
varying float vTw;
void main() {
  vTw = 0.5 + 0.5 * sin(uTime * (0.4 + fract(aPhase * 7.13) * 1.4) + aPhase * 39.0);
  gl_PointSize = aSize * uDpr;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const STAR_FRAG = /* glsl */ `
varying float vTw;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.12, d) * (0.2 + 0.5 * vTw) * 0.45;
  gl_FragColor = vec4(vec3(0.72, 0.78, 0.95) * a, a);
}
`;

function ridgeY(x: number, seed: number, base: number, amp: number): number {
  return (
    base +
    amp *
      (0.55 * Math.sin(x * 0.055 + seed) +
        0.3 * Math.sin(x * 0.13 + seed * 2.7) +
        0.15 * Math.sin(x * 0.29 + seed * 5.1))
  );
}

function makeRidgeMesh(
  seed: number,
  base: number,
  amp: number,
  color: number,
  z: number,
): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-100, 0);
  for (let x = -100; x <= 100; x += 2.5) {
    shape.lineTo(x, Math.max(0.05, ridgeY(x, seed, base, amp)));
  }
  shape.lineTo(100, 0);
  shape.closePath();
  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color }),
  );
  mesh.position.z = z;
  return mesh;
}

function makeTorii(): THREE.Group {
  const g = new THREE.Group();
  // 仕様色 #04051483 = #040514 × α0.51 のシルエット
  const mat = new THREE.MeshBasicMaterial({
    color: 0x040514,
    transparent: true,
    opacity: 0.51,
    depthWrite: false,
  });
  const part = (w: number, h: number, x: number, y: number): void => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, 0);
    g.add(m);
  };
  part(0.14, 1.15, -0.44, 0.58); // 左柱
  part(0.14, 1.15, 0.44, 0.58); // 右柱
  part(1.14, 0.1, 0, 0.82); // 貫
  part(1.4, 0.13, 0, 1.16); // 島木
  part(1.56, 0.09, 0, 1.27); // 笠木
  return g;
}

function makePersonGeometry(): THREE.ShapeGeometry {
  const body = new THREE.Shape();
  body.moveTo(-0.34, -0.9);
  body.lineTo(-0.34, 0.02);
  body.quadraticCurveTo(-0.33, 0.24, -0.12, 0.28);
  body.lineTo(0.12, 0.28);
  body.quadraticCurveTo(0.33, 0.24, 0.34, 0.02);
  body.lineTo(0.34, -0.9);
  body.closePath();
  const head = new THREE.Shape();
  head.absarc(0, 0.42, 0.17, 0, TAU, false);
  return new THREE.ShapeGeometry([body, head]);
}

export class Background {
  readonly group = new THREE.Group();
  /** festival モードでのみ表示する要素 */
  private festivalGroup = new THREE.Group();
  private starMat: THREE.ShaderMaterial;
  private clouds: { sprite: THREE.Sprite; speed: number }[] = [];
  private cloudTexture: THREE.Texture;
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  constructor(pixelRatio: number) {
    // ---- 空 ----
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color("#04051a") },
        uMid: { value: new THREE.Color("#0e1338") },
        uHorizon: { value: new THREE.Color("#241a2e") },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      depthWrite: false,
    });
    const skyGeo = new THREE.PlaneGeometry(320, 150);
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.position.set(0, 15, -48);
    sky.renderOrder = -10;
    this.group.add(sky);
    this.disposables.push(skyGeo, skyMat);

    // ---- 星 ----
    const STAR_COUNT = 250;
    const starPos = new Float32Array(STAR_COUNT * 3);
    const starPhase = new Float32Array(STAR_COUNT);
    const starSize = new Float32Array(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i++) {
      starPos[i * 3] = rand(-75, 75);
      starPos[i * 3 + 1] = rand(2.5, 42);
      starPos[i * 3 + 2] = -46;
      starPhase[i] = rand(0, 100);
      starSize[i] = rand(1.0, 2.3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute("aPhase", new THREE.BufferAttribute(starPhase, 1));
    starGeo.setAttribute("aSize", new THREE.BufferAttribute(starSize, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uDpr: { value: pixelRatio } },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const stars = new THREE.Points(starGeo, this.starMat);
    stars.frustumCulled = false;
    this.group.add(stars);
    this.disposables.push(starGeo, this.starMat);

    // ---- 以下 festival 限定 ----
    this.group.add(this.festivalGroup);

    // 山 (遠いほうが空に近い色)
    const farMtn = makeRidgeMesh(1.7, 2.6, 1.3, 0x080b24, -34);
    const nearMtn = makeRidgeMesh(4.2, 1.5, 1.0, 0x05071c, -26);
    this.festivalGroup.add(farMtn, nearMtn);
    this.disposables.push(farMtn.geometry, farMtn.material as THREE.Material);
    this.disposables.push(nearMtn.geometry, nearMtn.material as THREE.Material);

    // 鳥居 (手前の尾根の右)
    const torii = makeTorii();
    const tx = 6.8;
    torii.position.set(tx, ridgeY(tx, 4.2, 1.5, 1.0) - 0.08, -25.6);
    torii.scale.setScalar(1.55);
    this.festivalGroup.add(torii);
    torii.traverse((o) => {
      if (o instanceof THREE.Mesh) this.disposables.push(o.geometry);
    });
    this.disposables.push(
      (torii.children[0] as THREE.Mesh).material as THREE.Material,
    );

    // 雲 (ごく薄く、ゆっくり流れる)
    this.cloudTexture = createCloudTexture();
    const cloudDefs: [number, number, number, number, number, number][] = [
      [-18, 9.5, 17, 4.2, 0.05, 0.05],
      [14, 12.5, 23, 5.2, 0.04, 0.03],
    ];
    for (const [x, y, sx, sy, op, speed] of cloudDefs) {
      const mat = new THREE.SpriteMaterial({
        map: this.cloudTexture,
        color: 0x9aa2c0,
        transparent: true,
        opacity: op,
        depthWrite: false,
        // NormalBlending スプライト × UnrealBloom の矩形アーティファクト回避 (smoke.ts と同じ)
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(x, y, -40);
      sprite.scale.set(sx, sy, 1);
      sprite.frustumCulled = false;
      this.festivalGroup.add(sprite);
      this.clouds.push({ sprite, speed });
      this.disposables.push(mat);
    }

    // 水面 (y<0 の帯。反射粒子を透けさせるため depthWrite しない)
    const waterGeo = new THREE.PlaneGeometry(240, 62);
    const waterMat = new THREE.MeshBasicMaterial({ color: 0x030417, depthWrite: false });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.01, -14);
    water.renderOrder = -5;
    this.festivalGroup.add(water);
    this.disposables.push(waterGeo, waterMat);

    // 観客シルエット (画面下端、水面より手前)
    const personGeo = makePersonGeometry();
    const personMat = new THREE.MeshBasicMaterial({ color: 0x01020a });
    const xs = [-5.8, -4.4, -3.1, -1.6, -0.2, 1.3, 2.8, 4.2, 5.7];
    for (const x of xs) {
      const m = new THREE.Mesh(personGeo, personMat);
      m.position.set(x + rand(-0.25, 0.25), rand(0.55, 0.8), 6 + rand(-0.4, 0.3));
      m.scale.setScalar(rand(0.85, 1.2));
      this.festivalGroup.add(m);
    }
    this.disposables.push(personGeo, personMat);
  }

  update(dt: number, time: number): void {
    this.starMat.uniforms.uTime.value = time;
    if (this.festivalGroup.visible) {
      for (const c of this.clouds) {
        c.sprite.position.x += c.speed * dt;
        if (c.sprite.position.x > 48) c.sprite.position.x = -48;
      }
    }
  }

  setMode(mode: BackgroundMode): void {
    this.festivalGroup.visible = mode === "festival";
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.cloudTexture.dispose();
    this.disposables = [];
  }
}
