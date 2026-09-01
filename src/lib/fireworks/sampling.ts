import * as THREE from "three";
import type { DrawPoint, DrawingData, Stroke } from "@/types";
import { TAU, clamp, rand } from "./math";

/**
 * DrawingData → 粒子ターゲット変換。
 * 各ストロークを等弧長間隔で再サンプリングし、粒子数は総描画長に比例させる (300〜1500)。
 * PNG 貼り付け感を避けるため xy 微ジッタ + 奥行き (±R*0.55) を必ず入れる。
 */

const MIN_PARTICLES = 300;
const MAX_PARTICLES = 1500;
/** 正規化空間の描画長 1.0 あたりの粒子数 */
const LENGTH_TO_PARTICLES = 180;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const baseColor = new THREE.Color();
const jitColor = new THREE.Color();

interface PreparedStroke {
  pts: DrawPoint[];
  cum: Float32Array; // 累積弧長
  len: number;
  color: string;
}

function prepare(drawing: DrawingData): PreparedStroke[] {
  const out: PreparedStroke[] = [];
  const strokes: Stroke[] = Array.isArray(drawing?.strokes) ? drawing.strokes : [];
  for (const s of strokes) {
    if (!s || !Array.isArray(s.points)) continue;
    const pts = s.points.filter(
      (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y),
    );
    if (pts.length === 0) continue;
    const cum = new Float32Array(pts.length);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      cum[i] = acc;
    }
    out.push({ pts, cum, len: acc, color: s.color });
  }
  return out;
}

function writeParticle(
  n: number,
  px: number,
  py: number,
  radius: number,
  outOffsets: Float32Array,
  outColors: Float32Array,
): void {
  const i3 = n * 3;
  outOffsets[i3] = (px - 0.5) * 2 * radius + rand(-1, 1) * radius * 0.03;
  outOffsets[i3 + 1] = -(py - 0.5) * 2 * radius + rand(-1, 1) * radius * 0.03;
  outOffsets[i3 + 2] = rand(-1, 1) * radius * 0.55;
  // 色相±4% / 明度±10% の揺らぎで線が有機的に見える
  jitColor.copy(baseColor).offsetHSL(rand(-0.04, 0.04), 0, rand(-0.1, 0.1));
  outColors[i3] = jitColor.r;
  outColors[i3 + 1] = jitColor.g;
  outColors[i3 + 2] = jitColor.b;
}

/**
 * @returns 書き込んだ粒子数 (0 にはならない: 空データは金色の輪にフォールバック)
 */
export function sampleDrawing(
  drawing: DrawingData,
  radius: number,
  outOffsets: Float32Array,
  outColors: Float32Array,
  capacity: number,
): number {
  const strokes = prepare(drawing);
  let n = 0;

  if (strokes.length === 0) {
    // フォールバック: 金色の輪
    baseColor.set("#ffd166");
    const count = Math.min(capacity, MIN_PARTICLES);
    for (let i = 0; i < count; i++) {
      const a = (TAU * i) / count;
      writeParticle(
        n++,
        0.5 + 0.34 * Math.cos(a),
        0.5 + 0.34 * Math.sin(a),
        radius,
        outOffsets,
        outColors,
      );
    }
    return n;
  }

  const totalLen = strokes.reduce((s, st) => s + st.len, 0);
  const total = Math.min(
    capacity,
    clamp(Math.round(totalLen * LENGTH_TO_PARTICLES), MIN_PARTICLES, MAX_PARTICLES),
  );

  for (const st of strokes) {
    if (n >= total) break;
    const share =
      totalLen > 1e-6
        ? Math.max(3, Math.round((total * st.len) / totalLen))
        : Math.max(3, Math.floor(total / strokes.length));
    const count = Math.min(share, total - n);
    if (count <= 0) break;

    baseColor.set(HEX_RE.test(st.color) ? st.color : "#ffd166");

    if (st.len <= 1e-6 || st.pts.length < 2) {
      // 点打ち: その場に小さく散らす
      const p = st.pts[0];
      for (let k = 0; k < count; k++) {
        writeParticle(
          n++,
          p.x + rand(-0.012, 0.012),
          p.y + rand(-0.012, 0.012),
          radius,
          outOffsets,
          outColors,
        );
      }
      continue;
    }

    const step = st.len / count;
    let seg = 1;
    for (let k = 0; k < count; k++) {
      const d = (k + 0.5) * step;
      while (seg < st.pts.length - 1 && st.cum[seg] < d) seg++;
      const d0 = st.cum[seg - 1];
      const d1 = st.cum[seg];
      const t = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
      const a = st.pts[seg - 1];
      const b = st.pts[seg];
      writeParticle(
        n++,
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t,
        radius,
        outOffsets,
        outColors,
      );
    }
  }

  return n;
}
