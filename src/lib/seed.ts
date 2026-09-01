import type { DrawingData, DrawPoint, FireworkRecord } from "@/types";

/**
 * 投稿0件のときに使う初期花火 (仕様 §34)。
 * 丸・星・ハート・ニコちゃん・花 を手続き的に生成する。
 */

const TAU = Math.PI * 2;

function circlePoints(
  cx: number,
  cy: number,
  r: number,
  n = 48,
  start = 0,
  sweep = TAU,
): DrawPoint[] {
  const pts: DrawPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const a = start + (sweep * i) / n;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

function heartPoints(cx: number, cy: number, scale: number): DrawPoint[] {
  const pts: DrawPoint[] = [];
  for (let i = 0; i <= 72; i++) {
    const t = (TAU * i) / 72;
    const x = 16 * Math.sin(t) ** 3;
    const y =
      13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push({ x: cx + (x / 17) * scale, y: cy - (y / 17) * scale });
  }
  return pts;
}

function starPoints(cx: number, cy: number, rOuter: number, rInner: number): DrawPoint[] {
  const corners: DrawPoint[] = [];
  for (let i = 0; i <= 10; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = -Math.PI / 2 + (TAU * i) / 10;
    corners.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  // 各辺を補間して線として自然な密度にする
  const pts: DrawPoint[] = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const a = corners[i];
    const b = corners[i + 1];
    for (let j = 0; j < 6; j++) {
      const t = j / 6;
      pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  pts.push(corners[corners.length - 1]);
  return pts;
}

export function getSeedDrawings(): { drawing: DrawingData; message: string }[] {
  const circle: DrawingData = {
    strokes: [{ color: "#ffd94d", points: circlePoints(0.5, 0.5, 0.34) }],
  };

  const star: DrawingData = {
    strokes: [{ color: "#5ddfff", points: starPoints(0.5, 0.52, 0.38, 0.16) }],
  };

  const heart: DrawingData = {
    strokes: [{ color: "#ff4d5e", points: heartPoints(0.5, 0.52, 0.4) }],
  };

  const smiley: DrawingData = {
    strokes: [
      { color: "#ffd94d", points: circlePoints(0.5, 0.5, 0.36) },
      { color: "#fff6e8", points: circlePoints(0.38, 0.42, 0.045, 16) },
      { color: "#fff6e8", points: circlePoints(0.62, 0.42, 0.045, 16) },
      // 口: 下向きの弧
      { color: "#ff9a3d", points: circlePoints(0.5, 0.5, 0.2, 24, TAU * 0.08, TAU * 0.34) },
    ],
  };

  const petals: DrawingData["strokes"] = [];
  for (let i = 0; i < 6; i++) {
    const a = (TAU * i) / 6;
    petals.push({
      color: "#ff6bd6",
      points: circlePoints(0.5 + 0.22 * Math.cos(a), 0.5 + 0.22 * Math.sin(a), 0.13, 24),
    });
  }
  const flower: DrawingData = {
    strokes: [...petals, { color: "#ffd94d", points: circlePoints(0.5, 0.5, 0.08, 20) }],
  };

  return [
    { drawing: circle, message: "" },
    { drawing: star, message: "" },
    { drawing: heart, message: "" },
    { drawing: smiley, message: "" },
    { drawing: flower, message: "" },
  ];
}

/** シードを FireworkRecord 形式にする (id は seed-0, seed-1, ...) */
export function getSeedRecords(): FireworkRecord[] {
  return getSeedDrawings().map((s, i) => ({
    id: `seed-${i}`,
    drawing_data: s.drawing,
    message: s.message,
    created_at: new Date(0).toISOString(),
    status: "approved" as const,
    shown_count: 0,
    last_shown_at: null,
  }));
}
