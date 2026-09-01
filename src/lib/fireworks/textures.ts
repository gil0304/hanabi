import * as THREE from "three";

/**
 * 手続きテクスチャ生成。document を触るため必ず mount 時 (クライアント) にのみ呼ぶこと。
 */

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

/** 全粒子共通のラジアルグロー */
export function createGlowTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.22, "rgba(255,255,255,0.88)");
  g.addColorStop(0.5, "rgba(255,255,255,0.22)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(c);
}

/** 爆発の瞬間のフラッシュ */
export function createFlashTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,250,235,1)");
  g.addColorStop(0.12, "rgba(255,240,215,0.85)");
  g.addColorStop(0.45, "rgba(255,220,180,0.18)");
  g.addColorStop(1, "rgba(255,210,170,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return toTexture(c);
}

/** 煙ビルボード: 少し不揃いな柔らかい塊 */
export function createSmokeTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  const blobs: [number, number, number, number][] = [
    [64, 64, 58, 0.5],
    [46, 52, 34, 0.35],
    [84, 58, 30, 0.32],
    [60, 84, 32, 0.3],
  ];
  for (const [x, y, r, a] of blobs) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.6, `rgba(255,255,255,${a * 0.4})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  return toTexture(c);
}

/** ごく薄い夜雲 */
export function createCloudTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 96);
  const blobs: [number, number, number, number, number][] = [
    [128, 52, 110, 34, 0.5],
    [70, 46, 60, 24, 0.4],
    [190, 44, 66, 22, 0.42],
    [128, 38, 50, 18, 0.3],
  ];
  for (const [x, y, rx, ry, a] of blobs) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    ctx.translate(-x, -y);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 96);
    ctx.restore();
  }
  return toTexture(c);
}
