"use client";

import { useEffect, useRef } from "react";
import styles from "./CelebrationOverlay.module.css";

interface CelebrationOverlayProps {
  /** 投稿したストロークの色。爆発の粒子色に使う */
  colors: string[];
  /** 演出終了 (~2秒後) に一度だけ呼ばれる */
  onDone: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
  ttl: number;
  size: number;
}

const TAU = Math.PI * 2;
const RISE_MS = 650;
const TOTAL_MS = 2100;

export default function CelebrationOverlay({ colors, onDone }: CelebrationOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // アニメーション中に props が変わっても演出を乱さないよう ref 経由で参照する
  const onDoneRef = useRef(onDone);
  const colorsRef = useRef(colors);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);
  useEffect(() => {
    colorsRef.current = colors;
  }, [colors]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.scale(dpr, dpr);

    const palette = colorsRef.current.length > 0 ? colorsRef.current : ["#ffd94d"];
    const cx = w / 2;
    const burstY = h * 0.36;
    const particles: Particle[] = [];
    let burst = false;
    let finished = false;
    let start = 0;
    let last = 0;
    let raf = 0;

    const spawnBurst = () => {
      const n = 120;
      const baseR = Math.min(w, h) * 0.34;
      for (let i = 0; i < n; i++) {
        const angle = (TAU * i) / n + (Math.random() - 0.5) * 0.12;
        const speed = baseR * (1.2 + Math.random() * 1.2);
        particles.push({
          x: cx,
          y: burstY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color: palette[i % palette.length],
          life: 0,
          ttl: 850 + Math.random() * 500,
          size: 2 + Math.random() * 2,
        });
      }
    };

    const frame = (t: number) => {
      if (start === 0) {
        start = t;
        last = t;
      }
      const elapsed = t - start;
      const dt = Math.min(0.048, (t - last) / 1000);
      last = t;
      ctx.clearRect(0, 0, w, h);

      if (elapsed < RISE_MS) {
        // 上昇: 下から光の玉がヒューっと昇る
        const k = elapsed / RISE_MS;
        const ease = 1 - (1 - k) ** 3;
        const y = h + 20 + (burstY - h - 20) * ease;
        const x = cx + Math.sin(elapsed * 0.02) * 4;

        const tail = ctx.createLinearGradient(x, y, x, y + 70);
        tail.addColorStop(0, "rgba(255, 209, 102, 0.8)");
        tail.addColorStop(1, "rgba(255, 209, 102, 0)");
        ctx.strokeStyle = tail;
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 70);
        ctx.stroke();

        ctx.shadowColor = "#ffd166";
        ctx.shadowBlur = 16;
        ctx.fillStyle = "#ffe9b0";
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, TAU);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        if (!burst) {
          burst = true;
          spawnBurst();
        }
        // 爆発直後の閃光
        const sinceBurst = elapsed - RISE_MS;
        if (sinceBurst < 150) {
          const fk = sinceBurst / 150;
          ctx.globalAlpha = (1 - fk) * 0.5;
          ctx.fillStyle = "#fff8f0";
          ctx.beginPath();
          ctx.arc(cx, burstY, 12 + fk * 70, 0, TAU);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        const gravity = 260;
        for (const p of particles) {
          p.life += dt * 1000;
          if (p.life >= p.ttl) continue;
          const drag = Math.exp(-1.4 * dt);
          p.vx *= drag;
          p.vy = p.vy * drag + gravity * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          const a = 1 - p.life / p.ttl;
          ctx.globalAlpha = a;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 10;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.5 + 0.5 * a), 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      }

      if (elapsed >= TOTAL_MS) {
        if (!finished) {
          finished = true;
          onDoneRef.current();
        }
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={styles.overlay} role="status">
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden />
      <p className={styles.text}>夜空にあがるよ！</p>
    </div>
  );
}
