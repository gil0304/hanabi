/**
 * 共有型定義 — 全モジュールがここを唯一の契約とする。
 * 座標は 0.0〜1.0 に正規化(左上原点)。
 */

export interface DrawPoint {
  x: number;
  y: number;
}

export interface Stroke {
  color: string; // hex e.g. "#ff3355"
  points: DrawPoint[];
}

export interface DrawingData {
  strokes: Stroke[];
}

export type FireworkStatus = "pending" | "approved" | "hidden";

export interface FireworkRecord {
  id: string;
  drawing_data: DrawingData;
  message: string; // 最大50文字, 空文字可
  created_at: string; // ISO 8601
  status: FireworkStatus;
  shown_count: number;
  last_shown_at: string | null; // ISO 8601
}

export type BackgroundMode = "festival" | "minimal";

export interface ScreenSettings {
  /** 打ち上げ間隔の基準秒数 (1〜10)。実際は ±ランダム */
  fireworkInterval: number;
  /** 同時打ち上げ最大数 (1〜3) */
  concurrentFireworks: number;
  /** 花火消滅後に思い出メッセージを表示するか */
  messageVisible: boolean;
  /** 0.0〜1.0 */
  soundVolume: number;
  backgroundMode: BackgroundMode;
  /** スクリーン隅に投稿用QRを表示するか */
  qrVisible: boolean;
}

export const DEFAULT_SETTINGS: ScreenSettings = {
  fireworkInterval: 2.5,
  concurrentFireworks: 2,
  messageVisible: true,
  soundVolume: 0.8,
  backgroundMode: "festival",
  qrVisible: true,
};

export const MESSAGE_MAX_LENGTH = 50;

/** WebAudio 花火サウンドエンジンの契約 (src/lib/audio が実装) */
export interface FireworksAudioApi {
  /** ユーザージェスチャー後に呼ぶ。AudioContext を開始する */
  resume(): Promise<void>;
  setVolume(v: number): void;
  /** ヒュー音。打ち上げ上昇時 */
  playLaunch(): void;
  /** 爆発音。size は 0..1 (粒子数に比例)。連続再生でも音色/ピッチが毎回揺らぐこと */
  playBurst(size: number): void;
  /** パチパチ火の粉音 */
  playCrackle(): void;
  /** 夜の環境音 + ごく薄い祭の気配。ループ */
  startAmbience(): void;
  stopAmbience(): void;
}
