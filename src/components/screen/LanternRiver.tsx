"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import styles from "@/components/screen/screen.module.css";

/**
 * 思い出メッセージを灯篭流しとして画面下部に流す (仕様 §35 の表示形態)。
 * 花火が消えるたびに新しい灯篭が加わり、直近の思い出も静かに巡回する。
 * 花火より目立たないこと。
 */

export interface LanternRiverHandle {
  /** 新しい思い出。次の灯篭として優先的に流す */
  push(text: string): void;
  /** 起動時の初期プール (優先スポーンはしない)。古い順に渡す */
  seed(texts: string[]): void;
}

interface Lantern {
  id: number;
  text: string;
  /** 画面横断にかける秒数 */
  duration: number;
  /** 水面上のレーン (bottom %) */
  bottom: number;
  /** 揺れアニメーションの開始オフセット (s) */
  bobDelay: number;
  /** 紙の色味の個体差 (deg) */
  hue: number;
  scale: number;
}

const MAX_ACTIVE = 6;
const POOL_MAX = 30;
/** 通常スポーン間隔 (ms) */
const SPAWN_MIN_MS = 8_000;
const SPAWN_MAX_MS = 15_000;
/** push 直後の優先スポーンまでの間 (ms) */
const FRESH_SPAWN_DELAY_MS = 1_800;

const rand = (min: number, max: number) => min + Math.random() * (max - min);

interface LanternRiverProps {
  enabled: boolean;
  ref?: Ref<LanternRiverHandle>;
}

export default function LanternRiver({ enabled, ref }: LanternRiverProps) {
  const [lanterns, setLanterns] = useState<Lantern[]>([]);
  const poolRef = useRef<string[]>([]);
  const poolIndexRef = useRef(0);
  const freshRef = useRef<string[]>([]);
  const idRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);
  const enabledRef = useRef(enabled);
  const activeCountRef = useRef(0);

  const spawn = useCallback(() => {
    if (!enabledRef.current) return;
    if (activeCountRef.current >= MAX_ACTIVE) return;
    const text =
      freshRef.current.shift() ??
      (poolRef.current.length > 0
        ? poolRef.current[poolIndexRef.current++ % poolRef.current.length]
        : undefined);
    if (text === undefined) return;

    idRef.current += 1;
    const lantern: Lantern = {
      id: idRef.current,
      text,
      duration: rand(55, 85),
      bottom: rand(1.5, 6.5),
      bobDelay: rand(0, 6),
      hue: rand(-10, 8),
      scale: rand(0.88, 1.08),
    };
    activeCountRef.current += 1;
    setLanterns((prev) => [...prev, lantern]);
  }, []);

  const scheduleNext = useCallback(
    (delayMs: number) => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        spawn();
        scheduleNext(rand(SPAWN_MIN_MS, SPAWN_MAX_MS));
      }, delayMs);
    },
    [spawn],
  );

  useImperativeHandle(
    ref,
    () => ({
      push(text: string) {
        const t = text.trim();
        if (t.length === 0) return;
        freshRef.current.push(t);
        if (freshRef.current.length > 10) freshRef.current.shift();
        poolRef.current.push(t);
        while (poolRef.current.length > POOL_MAX) poolRef.current.shift();
        // 新しい思い出はほどなく水面に現れる
        scheduleNext(FRESH_SPAWN_DELAY_MS);
      },
      seed(texts: string[]) {
        for (const raw of texts) {
          const t = raw.trim();
          if (t.length === 0) continue;
          poolRef.current.push(t);
        }
        while (poolRef.current.length > POOL_MAX) poolRef.current.shift();
      },
    }),
    [scheduleNext],
  );

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      // OFF は即座に消す (仕様: 思い出表示は設定で無効化できる)
      setLanterns([]);
      activeCountRef.current = 0;
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
      return;
    }
    scheduleNext(rand(2_500, 5_000));
    return () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    };
  }, [enabled, scheduleNext]);

  const handleDriftEnd = useCallback((id: number) => {
    activeCountRef.current = Math.max(0, activeCountRef.current - 1);
    setLanterns((prev) => prev.filter((l) => l.id !== id));
  }, []);

  if (!enabled || lanterns.length === 0) return null;

  return (
    <div className={styles.lanternRiver} aria-hidden="true">
      {lanterns.map((l) => (
        <div
          key={l.id}
          className={styles.lantern}
          style={
            {
              bottom: `${l.bottom}%`,
              "--drift-dur": `${l.duration}s`,
              "--bob-delay": `${-l.bobDelay}s`,
              "--paper-hue": `${l.hue}deg`,
              "--lantern-scale": l.scale,
            } as React.CSSProperties
          }
          onAnimationEnd={(e) => {
            // 子要素の揺れ/明滅アニメではなく、自身の drift 終了のみ拾う
            if (e.target === e.currentTarget) handleDriftEnd(l.id);
          }}
        >
          <div className={styles.lanternBob}>
            <div className={styles.lanternBody}>
              <span className={styles.lanternText}>{l.text}</span>
            </div>
            <div className={styles.lanternGlowWater} />
          </div>
        </div>
      ))}
    </div>
  );
}
