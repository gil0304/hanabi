import type { BackgroundMode, FireworkRecord } from "@/types";

export type LaunchHeight = "low" | "medium" | "high";

export interface LaunchOptions {
  /** 打ち上げ地点の水平位置 0..1 (省略時 左/中央/右からランダム) */
  x?: number;
  /** 省略時ランダム */
  height?: LaunchHeight;
}

/** レンダラー → 外側(音・メッセージ表示)への通知 */
export interface FireworksRendererEvents {
  /** 打ち上げ(上昇開始)時 */
  onLaunch?: () => void;
  /** 爆発の瞬間。size は 0..1 (粒子数に比例) */
  onBurst?: (size: number) => void;
  /** 爆発の少し後、火の粉のパチパチ */
  onCrackle?: () => void;
  /** 花火が消え終わった時。メッセージ表示のトリガに使う */
  onFireworkEnd?: (record: FireworkRecord) => void;
}

/**
 * Three.js 花火レンダラーの契約 (src/lib/fireworks が実装)。
 * スクリーンページはこの API だけを使う。
 */
export interface FireworksRenderer {
  /** container 内に canvas を生成して描画ループを開始する */
  mount(container: HTMLElement): void;
  /** 1発打ち上げる (上昇→爆発→展開→消滅までレンダラー内で完結) */
  launch(record: FireworkRecord, opts?: LaunchOptions): void;
  /** 現在上昇中/展開中の花火の数 */
  activeCount(): number;
  setBackgroundMode(mode: BackgroundMode): void;
  dispose(): void;
}

export type CreateFireworksRenderer = (
  events?: FireworksRendererEvents,
) => FireworksRenderer;
