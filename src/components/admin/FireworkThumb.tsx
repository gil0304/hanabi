"use client";

import { useEffect, useRef } from "react";
import type { DrawingData } from "@/types";
import styles from "@/components/admin/admin.module.css";

/**
 * 投稿された DrawingData を夜空風の小さなキャンバスに光る線で描くサムネイル。
 * 座標は 0..1 正規化 (左上原点) 前提。
 */
export default function FireworkThumb({
  drawing,
  size = 120,
}: {
  drawing: DrawingData;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // width/height の再代入でコンテキスト状態はリセットされるため scale の重複適用は起きない
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // 背景: 夜空のグラデーション
    const bg = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size * 0.75,
    );
    bg.addColorStop(0, "#10163a");
    bg.addColorStop(1, "#060920");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // 加算合成で線の重なりを発光させる
    ctx.globalCompositeOperation = "lighter";

    for (const stroke of drawing.strokes) {
      if (stroke.points.length === 0) continue;
      const path = new Path2D();
      const first = stroke.points[0];
      path.moveTo(first.x * size, first.y * size);
      if (stroke.points.length === 1) {
        // 1点だけのストロークも点として見えるように
        path.lineTo(first.x * size + 0.01, first.y * size);
      }
      for (let i = 1; i < stroke.points.length; i++) {
        const p = stroke.points[i];
        path.lineTo(p.x * size, p.y * size);
      }

      // グロー(ぼかし広め) → 芯(細く明るく) の2度描き
      ctx.shadowColor = stroke.color;
      ctx.strokeStyle = stroke.color;
      ctx.shadowBlur = 9;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 4;
      ctx.stroke(path);
      ctx.shadowBlur = 3;
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5;
      ctx.stroke(path);
    }
  }, [drawing, size]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.thumb}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
