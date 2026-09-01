"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MESSAGE_MAX_LENGTH } from "@/types";
import { DEFAULT_COLOR } from "@/lib/constants";
import { getStore } from "@/lib/store/client";
import DrawCanvas, { type DrawCanvasHandle } from "@/components/drawing/DrawCanvas";
import ColorPalette from "@/components/drawing/ColorPalette";
import CelebrationOverlay from "@/components/drawing/CelebrationOverlay";
import styles from "./page.module.css";

export default function SubmitPage() {
  const canvasRef = useRef<DrawCanvasHandle>(null);
  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  const [message, setMessage] = useState("");
  const [empty, setEmpty] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [celebration, setCelebration] = useState<string[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [msgFocused, setMsgFocused] = useState(false);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    },
    [],
  );

  const handleSubmit = async () => {
    const handle = canvasRef.current;
    if (!handle || submitting) return;
    const drawing = handle.getDrawing();
    if (drawing.strokes.length === 0) return;
    const trimmed = message.trim().slice(0, MESSAGE_MAX_LENGTH);

    setSubmitting(true);
    try {
      const result = await getStore().submitFirework(drawing, trimmed);
      if (result.ok) {
        // 使った色をそのまま祝福アニメの粒子色にする
        const used: string[] = [];
        for (const s of drawing.strokes) {
          if (!used.includes(s.color)) used.push(s.color);
        }
        setCelebration(used);
      } else {
        showToast(
          result.error === "rate_limited"
            ? "少しまってからもう一度"
            : "うまく飛ばせなかった…もう一度",
        );
      }
    } catch {
      showToast("うまく飛ばせなかった…もう一度");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCelebrationDone = useCallback(() => {
    // 次の1枚のためにリセット (選択色は保持)
    canvasRef.current?.clear();
    setMessage("");
    setCelebration(null);
  }, []);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <span className={styles.headerAccent} aria-hidden>
          🎆
        </span>
        <h1 className={styles.title}>花火をつくろう</h1>
      </header>

      <div className={styles.canvasCard}>
        <DrawCanvas ref={canvasRef} color={color} onEmptyChange={setEmpty} />
      </div>

      <ColorPalette value={color} onChange={setColor} />

      <div className={styles.tools}>
        <button
          type="button"
          className={styles.ghost}
          onClick={() => canvasRef.current?.undo()}
        >
          ⌫ ひとつ戻す
        </button>
        <button
          type="button"
          className={styles.ghost}
          onClick={() => canvasRef.current?.clear()}
        >
          ぜんぶ消す
        </button>
      </div>

      <div className={styles.messageWrap}>
        <input
          className={styles.message}
          type="text"
          value={message}
          maxLength={MESSAGE_MAX_LENGTH}
          placeholder="夏の思い出を書いてみよう"
          onChange={(e) => setMessage(e.target.value)}
          onFocus={() => setMsgFocused(true)}
          onBlur={() => setMsgFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          enterKeyHint="done"
        />
        {(msgFocused || message.length > 0) && (
          <span className={styles.counter}>
            {message.length}/{MESSAGE_MAX_LENGTH}
          </span>
        )}
      </div>

      <button
        type="button"
        className={styles.submit}
        disabled={empty || submitting}
        onClick={handleSubmit}
      >
        {submitting && <span className={styles.spinner} aria-hidden />}
        花火を打ち上げる
      </button>

      {toast && (
        <div className={styles.toast} role="alert">
          {toast}
        </div>
      )}

      {celebration && (
        <CelebrationOverlay colors={celebration} onDone={handleCelebrationDone} />
      )}
    </main>
  );
}
