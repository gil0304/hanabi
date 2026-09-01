"use client";

import styles from "@/components/screen/screen.module.css";

interface StartOverlayProps {
  fading: boolean;
  onStart: () => void;
}

/** 音声の自動再生制限を回避するための開始オーバーレイ (画面のどこでもタップ可) */
export default function StartOverlay({ fading, onStart }: StartOverlayProps) {
  return (
    <div
      className={
        fading ? `${styles.overlay} ${styles.overlayFading}` : styles.overlay
      }
      role="button"
      tabIndex={0}
      aria-label="タップで開始"
      onClick={onStart}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onStart();
      }}
    >
      <div className={styles.ornament} aria-hidden="true">
        <span className={styles.ornamentLine} />
        <span className={styles.ornamentDot} />
        <span className={`${styles.ornamentLine} ${styles.ornamentLineFlip}`} />
      </div>
      <h1 className={styles.title}>デジタル花火大会</h1>
      <p className={styles.subtitle}>みんなで作る、一夜限りの花火大会。</p>
      <span className={styles.pill}>タップで開始</span>
    </div>
  );
}
