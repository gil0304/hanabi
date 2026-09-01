import * as THREE from "three";
import { rand } from "./math";

/**
 * 煙プール。花火スロットとは独立に生存させる
 * (煙は 6〜14 秒残るため、スロットを煙の寿命で塞がないようレンダラー全体で共有する)。
 */

const POOL_SIZE = 36;
const WIND_X = 0.12;

interface Puff {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  age: number;
  life: number;
  peak: number;
  grow: number;
  vx: number;
  vy: number;
  rot: number;
  scale: number;
  active: boolean;
}

export class SmokePool {
  readonly group = new THREE.Group();
  private puffs: Puff[] = [];

  constructor(texture: THREE.Texture) {
    for (let i = 0; i < POOL_SIZE; i++) {
      const mat = new THREE.SpriteMaterial({
        map: texture,
        color: 0x59606e,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        // NormalBlending の半透明スプライトは UnrealBloomPass と干渉して
        // 四角いアーティファクトになるため、光を受けた夜霞として加算合成する
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.frustumCulled = false;
      this.group.add(sprite);
      this.puffs.push({
        sprite,
        mat,
        age: 0,
        life: 1,
        peak: 0,
        grow: 0,
        vx: 0,
        vy: 0,
        rot: 0,
        scale: 1,
        active: false,
      });
    }
  }

  private spawn(
    x: number,
    y: number,
    z: number,
    scale: number,
    peak: number,
    life: number,
    grow: number,
  ): void {
    let puff = this.puffs.find((p) => !p.active);
    if (!puff) {
      // 空きなし: 最も古いものを再利用
      puff = this.puffs.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b));
    }
    puff.active = true;
    puff.age = 0;
    puff.life = life;
    puff.peak = peak;
    puff.grow = grow;
    puff.scale = scale;
    puff.vx = rand(-0.05, 0.05);
    puff.vy = rand(0.1, 0.28);
    puff.rot = rand(-0.12, 0.12);
    puff.sprite.position.set(x, y, z);
    puff.sprite.visible = true;
    puff.mat.rotation = rand(0, Math.PI * 2);
    puff.mat.opacity = 0;
  }

  /** 爆発後の煙: 3〜6 個 */
  burst(x: number, y: number, z: number): void {
    const n = 3 + Math.floor(rand(0, 4));
    for (let i = 0; i < n; i++) {
      this.spawn(
        x + rand(-0.9, 0.9),
        y + rand(-0.5, 0.8),
        z + rand(-0.5, 0.5),
        rand(1.1, 2.0),
        0.1 * rand(0.7, 1.1),
        rand(6, 14),
        rand(0.16, 0.3),
      );
    }
  }

  /** 上昇中のかすかな煙の気配 */
  hint(x: number, y: number, z: number): void {
    this.spawn(x + rand(-0.15, 0.15), y, z, rand(0.3, 0.55), 0.04, rand(2, 3.5), 0.14);
  }

  update(dt: number): void {
    for (const p of this.puffs) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        p.sprite.visible = false;
        p.mat.opacity = 0;
        continue;
      }
      p.scale += p.grow * dt;
      p.sprite.position.x += (p.vx + WIND_X) * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.scale.set(p.scale, p.scale * 0.92, 1);
      p.mat.rotation += p.rot * dt;
      const fadeIn = Math.min(p.age / 0.6, 1);
      const fadeOut = 1 - p.age / p.life;
      p.mat.opacity = p.peak * fadeIn * fadeOut;
    }
  }

  dispose(): void {
    for (const p of this.puffs) p.mat.dispose();
    this.puffs = [];
  }
}
