import type {
  DrawingData,
  FireworkRecord,
  FireworkStatus,
  ScreenSettings,
} from "@/types";

export type SubmitResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * データ層の契約。実装は2つ:
 *  - LocalStore   : Next.js API Route + ファイル永続化 + SSE (env 未設定時のフォールバック)
 *  - SupabaseStore: Supabase + Realtime (NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY 設定時)
 * `getStore()` (src/lib/store/client.ts) が環境変数を見て自動選択する。
 * すべてブラウザから呼ばれる。
 */
export interface FireworkStore {
  /** 投稿。バリデーション(文字数・ストローク有無)は呼び出し側でも行うが、店側でも守る */
  submitFirework(drawing: DrawingData, message: string): Promise<SubmitResult>;

  /**
   * スクリーン用: 次に打ち上げる花火を優先順位付きで取得する。
   * 優先: 未表示 → 表示回数が少ない → ランダム (仕様 §31)。
   * 返した花火の shown_count / last_shown_at を更新する。
   * approved のみ返す。0件の場合は空配列 (呼び出し側がシードにフォールバック)。
   */
  fetchNext(count: number): Promise<FireworkRecord[]>;

  /**
   * 新規投稿(approved)のリアルタイム購読。スクリーンが投稿直後打ち上げ (仕様 §32) に使う。
   * 戻り値は解除関数。
   */
  subscribeNewFireworks(cb: (fw: FireworkRecord) => void): () => void;

  getSettings(): Promise<ScreenSettings>;
  updateSettings(patch: Partial<ScreenSettings>): Promise<ScreenSettings>;
  /** 設定変更のリアルタイム購読 (スクリーンが追従)。戻り値は解除関数 */
  subscribeSettings(cb: (s: ScreenSettings) => void): () => void;

  // ---- 管理画面用 ----
  listAll(): Promise<FireworkRecord[]>;
  setStatus(id: string, status: FireworkStatus): Promise<void>;
  deleteAll(): Promise<void>;
}
