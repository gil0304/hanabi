"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScreenSettings } from "@/types";
import { getStore } from "@/lib/store/client";
import styles from "@/components/admin/admin.module.css";

type SaveState = "idle" | "saving" | "saved" | "error";

/** 汎用セグメントボタン */
function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className={styles.segmented} role="group">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          className={`${styles.segBtn} ${opt.value === value ? styles.segBtnActive : ""}`}
          aria-pressed={opt.value === value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`${styles.toggle} ${checked ? styles.toggleOn : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.toggleKnob} />
    </button>
  );
}

function formatSeconds(v: number): string {
  return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}秒`;
}

export default function SettingsPanel() {
  const [settings, setSettings] = useState<ScreenSettings | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);

  // 変更をまとめて 400ms デバウンス保存するためのバッファ
  const patchRef = useRef<Partial<ScreenSettings>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getStore().getSettings();
        if (!cancelled) setSettings(s);
      } catch {
        if (!cancelled) setLoadError("設定を読み込めませんでした");
      }
    })();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      // アンマウント時、未送信の変更があれば投げっぱなしで保存する
      const pending = patchRef.current;
      patchRef.current = {};
      if (Object.keys(pending).length > 0) {
        getStore()
          .updateSettings(pending)
          .catch(() => {});
      }
    };
  }, []);

  const flush = useCallback(async () => {
    const patch = patchRef.current;
    patchRef.current = {};
    if (Object.keys(patch).length === 0) return;
    try {
      await getStore().updateSettings(patch);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, []);

  const change = useCallback(
    <K extends keyof ScreenSettings>(key: K, value: ScreenSettings[K]) => {
      setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
      patchRef.current[key] = value;
      setSaveState("saving");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void flush();
      }, 400);
    },
    [flush],
  );

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>スクリーン設定</h2>
        <span
          className={`${styles.saveNote} ${saveState === "error" ? styles.saveNoteError : ""}`}
          aria-live="polite"
        >
          {saveState === "saving" && "保存中…"}
          {saveState === "saved" && "保存済み"}
          {saveState === "error" && "保存に失敗しました"}
        </span>
      </div>

      {loadError && <p className={styles.errorNote}>{loadError}</p>}
      {!settings && !loadError && <p className={styles.loading}>読み込み中…</p>}

      {settings && (
        <div className={styles.rows}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>打ち上げ間隔</span>
            <input
              type="range"
              min={1}
              max={10}
              step={0.5}
              value={settings.fireworkInterval}
              onChange={(e) =>
                change("fireworkInterval", Number(e.target.value))
              }
              className={styles.range}
              aria-label="打ち上げ間隔"
            />
            <span className={styles.rowValue}>
              {formatSeconds(settings.fireworkInterval)}
            </span>
          </div>

          <div className={styles.row}>
            <span className={styles.rowLabel}>同時打ち上げ</span>
            <Segmented
              options={[
                { value: 1, label: "1" },
                { value: 2, label: "2" },
                { value: 3, label: "3" },
              ]}
              value={settings.concurrentFireworks}
              onChange={(v) => change("concurrentFireworks", v)}
            />
            <span className={styles.rowValue} />
          </div>

          <div className={styles.row}>
            <span className={styles.rowLabel}>思い出表示</span>
            <Toggle
              checked={settings.messageVisible}
              onChange={(v) => change("messageVisible", v)}
              label="思い出表示"
            />
            <span className={styles.rowValue} />
          </div>

          <div className={styles.row}>
            <span className={styles.rowLabel}>音量</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.soundVolume}
              onChange={(e) => change("soundVolume", Number(e.target.value))}
              className={styles.range}
              aria-label="音量"
            />
            <span className={styles.rowValue}>
              {Math.round(settings.soundVolume * 100)}%
            </span>
          </div>

          <div className={styles.row}>
            <span className={styles.rowLabel}>背景</span>
            <Segmented
              options={[
                { value: "festival", label: "にぎやか" },
                { value: "minimal", label: "シンプル" },
              ]}
              value={settings.backgroundMode}
              onChange={(v) => change("backgroundMode", v)}
            />
            <span className={styles.rowValue} />
          </div>

          <div className={styles.row}>
            <span className={styles.rowLabel}>QR表示</span>
            <Toggle
              checked={settings.qrVisible}
              onChange={(v) => change("qrVisible", v)}
              label="QR表示"
            />
            <span className={styles.rowValue} />
          </div>
        </div>
      )}
    </section>
  );
}
