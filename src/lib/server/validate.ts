import type { DrawingData, ScreenSettings, Stroke } from "@/types";
import { MESSAGE_MAX_LENGTH } from "@/types";

/**
 * 投稿・設定のバリデーション/サニタイズ。
 * ブラウザ(Supabase ストア)とサーバー(API Route)の両方から使うため、
 * Node 依存を持たない純粋モジュールにしてある。
 */

export const MAX_STROKES = 60;
export const MAX_TOTAL_POINTS = 20000;

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const FALLBACK_COLOR = "#fff6e8";

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * 描画データを検証してサニタイズ済みの DrawingData を返す。
 * 不正(ストローク無し・上限超過・形式不正)の場合は null。
 */
export function sanitizeDrawing(input: unknown): DrawingData | null {
  if (!input || typeof input !== "object") return null;
  const strokesRaw = (input as { strokes?: unknown }).strokes;
  if (!Array.isArray(strokesRaw) || strokesRaw.length === 0) return null;
  if (strokesRaw.length > MAX_STROKES) return null;

  let totalPoints = 0;
  const strokes: Stroke[] = [];

  for (const s of strokesRaw) {
    if (!s || typeof s !== "object") return null;
    const colorRaw = (s as { color?: unknown }).color;
    const pointsRaw = (s as { points?: unknown }).points;
    if (!Array.isArray(pointsRaw)) return null;

    totalPoints += pointsRaw.length;
    if (totalPoints > MAX_TOTAL_POINTS) return null;

    const color =
      typeof colorRaw === "string" && COLOR_RE.test(colorRaw)
        ? colorRaw
        : FALLBACK_COLOR;

    const points: { x: number; y: number }[] = [];
    for (const p of pointsRaw) {
      if (!p || typeof p !== "object") continue;
      const x = (p as { x?: unknown }).x;
      const y = (p as { y?: unknown }).y;
      if (typeof x !== "number" || typeof y !== "number") continue;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push({ x: clamp(x, 0, 1), y: clamp(y, 0, 1) });
    }
    if (points.length > 0) {
      strokes.push({ color, points });
    }
  }

  if (strokes.length === 0) return null;
  return { strokes };
}

/**
 * メッセージを検証。制御文字を除去し trim した結果を返す。
 * 文字数超過は null (呼び出し側で 400)。
 */
export function sanitizeMessage(input: unknown): string | null {
  if (input == null) return "";
  if (typeof input !== "string") return null;
  const cleaned = input
    // 制御文字(改行含む) + 行/段落区切り + 双方向テキスト制御を除去
    .replace(/[\u0000-\u001f\u007f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    // 結合文字の積み上げ (zalgo) は 2 個までに制限
    .replace(/(\p{M}{2})\p{M}+/gu, "$1")
    .trim();
  if (cleaned.length > MESSAGE_MAX_LENGTH) return null;
  return cleaned;
}

/** 設定パッチの各フィールドを検証・クランプ。不正フィールドは黙って落とす */
export function sanitizeSettingsPatch(input: unknown): Partial<ScreenSettings> {
  const out: Partial<ScreenSettings> = {};
  if (!input || typeof input !== "object") return out;
  const o = input as Record<string, unknown>;

  if (typeof o.fireworkInterval === "number" && Number.isFinite(o.fireworkInterval)) {
    out.fireworkInterval = clamp(o.fireworkInterval, 1, 10);
  }
  if (
    typeof o.concurrentFireworks === "number" &&
    Number.isFinite(o.concurrentFireworks)
  ) {
    out.concurrentFireworks = clamp(Math.round(o.concurrentFireworks), 1, 3);
  }
  if (typeof o.soundVolume === "number" && Number.isFinite(o.soundVolume)) {
    out.soundVolume = clamp(o.soundVolume, 0, 1);
  }
  if (o.backgroundMode === "festival" || o.backgroundMode === "minimal") {
    out.backgroundMode = o.backgroundMode;
  }
  if (typeof o.messageVisible === "boolean") {
    out.messageVisible = o.messageVisible;
  }
  if (typeof o.qrVisible === "boolean") {
    out.qrVisible = o.qrVisible;
  }
  return out;
}
