"use client";

import {
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";
import type { DrawingData } from "@/types";
import { CANVAS_SIZE } from "@/lib/constants";
import { MAX_STROKES, MAX_TOTAL_POINTS } from "@/lib/server/validate";
import styles from "./DrawCanvas.module.css";

export interface DrawCanvasHandle {
  undo(): void;
  clear(): void;
  getDrawing(): DrawingData;
  isEmpty(): boolean;
}

interface DrawCanvasProps {
  /** 現在の描画色 (hex) */
  color: string;
  /** ストロークの有無が変化したとき (送信ボタンの活性制御用) */
  onEmptyChange?: (empty: boolean) => void;
  ref?: Ref<DrawCanvasHandle>;
}

type CanvasPointer = ReactPointerEvent<HTMLCanvasElement>;

/** 内部座標は 512px 空間で保持し、getDrawing() で 0..1 に正規化する */
interface RawPoint {
  x: number;
  y: number;
}
interface RawStroke {
  color: string;
  points: RawPoint[];
}

const TAU = Math.PI * 2;
const MIN_DIST = 3; // 点の間引き最小距離 (512px 空間)
const MAX_POINTS_PER_STROKE = 800;
const LINE_WIDTH = 10;
const GLOW_BLUR = 12;
const BG_COLOR = "#0a0e2a";

function clamp01x512(v: number): number {
  return Math.min(CANVAS_SIZE, Math.max(0, v));
}

export default function DrawCanvas({ color, onEmptyChange, ref }: DrawCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<RawStroke[]>([]);
  const activeStrokeRef = useRef<RawStroke | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const colorRef = useRef(color);
  /** 確定済みストロークの合計点数 (ポイント予算の判定用, pointerdown で再計算) */
  const committedPointsRef = useRef(0);

  useEffect(() => {
    colorRef.current = color;
  }, [color]);

  const setStrokeStyle = (ctx: CanvasRenderingContext2D, strokeColor: string) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = LINE_WIDTH;
    ctx.strokeStyle = strokeColor;
    // 光っている感じを出す (データには含まれない見た目だけの効果)
    ctx.shadowColor = strokeColor;
    ctx.shadowBlur = GLOW_BLUR;
  };

  const paintBase = (ctx: CanvasRenderingContext2D, withGuide: boolean) => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.shadowBlur = 0;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    if (withGuide) {
      // 描き始めると消える円形ガイド (ストロークデータには含めない)
      ctx.strokeStyle = "rgba(255, 248, 240, 0.12)";
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 10]);
      ctx.beginPath();
      ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE * 0.34, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255, 248, 240, 0.16)";
      ctx.beginPath();
      ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, 3, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  };

  const paintWholeStroke = (ctx: CanvasRenderingContext2D, stroke: RawStroke) => {
    if (stroke.points.length === 0) return;
    setStrokeStyle(ctx, stroke.color);
    if (stroke.points.length === 1) {
      // 1点だけのストロークは丸いドットとして描く
      const p = stroke.points[0];
      ctx.fillStyle = stroke.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, LINE_WIDTH / 2, 0, TAU);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  };

  const repaint = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const showGuide =
      strokesRef.current.length === 0 && activeStrokeRef.current === null;
    paintBase(ctx, showGuide);
    for (const s of strokesRef.current) paintWholeStroke(ctx, s);
    if (activeStrokeRef.current) paintWholeStroke(ctx, activeStrokeRef.current);
    ctx.shadowBlur = 0;
  };

  // マウント時に背景とガイドを描く (依存なしで一度だけ)
  useEffect(() => {
    repaint();
  }, []);

  const toPoint = (e: CanvasPointer): RawPoint => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: clamp01x512(((e.clientX - rect.left) / rect.width) * CANVAS_SIZE),
      y: clamp01x512(((e.clientY - rect.top) / rect.height) * CANVAS_SIZE),
    };
  };

  const handlePointerDown = (e: CanvasPointer) => {
    // 2本目以降の指は無視 (シングルポインタのみ)
    if (pointerIdRef.current !== null) return;
    // マウスの右/中クリックでは描かない (タッチ/ペンの主接触は button 0)
    if (e.button > 0) return;
    if (strokesRef.current.length >= MAX_STROKES) return;
    // サーバー検証 (MAX_TOTAL_POINTS) と同じ予算をクライアントでも守る
    committedPointsRef.current = strokesRef.current.reduce(
      (n, s) => n + s.points.length,
      0,
    );
    if (committedPointsRef.current >= MAX_TOTAL_POINTS) return;
    pointerIdRef.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 一部ブラウザで失敗しても描画は続行できる
    }
    const p = toPoint(e);
    activeStrokeRef.current = { color: colorRef.current, points: [p] };

    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    if (strokesRef.current.length === 0) {
      // 最初のストローク開始でガイドを消す
      paintBase(ctx, false);
    }
    setStrokeStyle(ctx, colorRef.current);
    ctx.fillStyle = colorRef.current;
    ctx.beginPath();
    ctx.arc(p.x, p.y, LINE_WIDTH / 2, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
  };

  const handlePointerMove = (e: CanvasPointer) => {
    if (e.pointerId !== pointerIdRef.current) return;
    const stroke = activeStrokeRef.current;
    if (!stroke || stroke.points.length >= MAX_POINTS_PER_STROKE) return;
    if (committedPointsRef.current + stroke.points.length >= MAX_TOTAL_POINTS) return;
    const p = toPoint(e);
    const last = stroke.points[stroke.points.length - 1];
    const dx = p.x - last.x;
    const dy = p.y - last.y;
    if (dx * dx + dy * dy < MIN_DIST * MIN_DIST) return;
    stroke.points.push(p);

    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    setStrokeStyle(ctx, stroke.color);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  const handlePointerEnd = (e: CanvasPointer) => {
    if (e.pointerId !== pointerIdRef.current) return;
    pointerIdRef.current = null;
    const stroke = activeStrokeRef.current;
    activeStrokeRef.current = null;
    if (stroke && stroke.points.length > 0) {
      strokesRef.current.push(stroke);
      onEmptyChange?.(false);
    }
  };

  useImperativeHandle(ref, () => ({
    undo() {
      strokesRef.current.pop();
      repaint();
      if (strokesRef.current.length === 0) onEmptyChange?.(true);
    },
    clear() {
      strokesRef.current = [];
      activeStrokeRef.current = null;
      pointerIdRef.current = null;
      repaint();
      onEmptyChange?.(true);
    },
    getDrawing(): DrawingData {
      return {
        strokes: strokesRef.current.map((s) => ({
          color: s.color,
          points: s.points.map((p) => ({
            // 0..1 に正規化。小数4桁でペイロードを軽くする
            x: Math.round((p.x / CANVAS_SIZE) * 10000) / 10000,
            y: Math.round((p.y / CANVAS_SIZE) * 10000) / 10000,
          })),
        })),
      };
    },
    isEmpty() {
      return strokesRef.current.length === 0;
    },
  }));

  return (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      width={CANVAS_SIZE}
      height={CANVAS_SIZE}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      aria-label="花火のおえかきキャンバス"
    />
  );
}
