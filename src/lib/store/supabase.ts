import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_SETTINGS,
  type DrawingData,
  type FireworkRecord,
  type FireworkStatus,
  type ScreenSettings,
} from "@/types";
import {
  sanitizeDrawing,
  sanitizeMessage,
  sanitizeSettingsPatch,
} from "@/lib/server/validate";
import type { FireworkStore, SubmitResult } from "./types";

/**
 * Supabase バックエンドの FireworkStore 実装 (ブラウザから anon key で直接アクセス)。
 * スキーマは supabase/schema.sql。リアルタイムは Supabase Realtime を使う。
 */

interface FireworkRow {
  id: string;
  drawing_data: DrawingData;
  message: string | null;
  created_at: string;
  status: string;
  shown_count: number | null;
  last_shown_at: string | null;
}

interface SettingsRow {
  id: number;
  data: Partial<ScreenSettings> | null;
}

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) {
    // NEXT_PUBLIC_* はビルド時にインライン展開されるためリテラル参照が必要
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    client = createClient(url, key, {
      auth: { persistSession: false },
    });
  }
  return client;
}

function toRecord(row: FireworkRow): FireworkRecord {
  const status: FireworkStatus =
    row.status === "pending" || row.status === "hidden" ? row.status : "approved";
  return {
    id: row.id,
    drawing_data: row.drawing_data,
    message: row.message ?? "",
    created_at: row.created_at,
    status,
    shown_count: row.shown_count ?? 0,
    last_shown_at: row.last_shown_at ?? null,
  };
}

function channelName(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readSettings(supabase: SupabaseClient): Promise<ScreenSettings> {
  const { data, error } = await supabase
    .from("screen_settings")
    .select("data")
    .eq("id", 1)
    .maybeSingle<Pick<SettingsRow, "data">>();
  if (error) return { ...DEFAULT_SETTINGS };
  if (!data) {
    // 行が無ければデフォルトで作成しておく
    await supabase
      .from("screen_settings")
      .upsert({ id: 1, data: DEFAULT_SETTINGS })
      .then(
        () => undefined,
        () => undefined,
      );
    return { ...DEFAULT_SETTINGS };
  }
  return { ...DEFAULT_SETTINGS, ...(data.data ?? {}) };
}

export function createSupabaseStore(): FireworkStore {
  /** この端末からの投稿時刻 (端末側レートリミット用) */
  let submitTimes: number[] = [];
  return {
    async submitFirework(
      drawing: DrawingData,
      message: string,
    ): Promise<SubmitResult> {
      // Supabase モードにはサーバー側レートリミットが無いため、端末側で
      // ローカルモードと同等の制限 (1.5s 間隔・6回/分) を掛ける。
      // 本気の防御は Edge Function / RLS 側で行うこと。
      const now = Date.now();
      submitTimes = submitTimes.filter((t) => now - t < 60_000);
      if (
        submitTimes.length >= 6 ||
        (submitTimes.length > 0 && now - submitTimes[submitTimes.length - 1] < 1_500)
      ) {
        return { ok: false, error: "rate_limited" };
      }
      submitTimes.push(now);

      // ローカルバックエンドと同じ検証をクライアント側で行う
      const cleanDrawing = sanitizeDrawing(drawing);
      if (!cleanDrawing) return { ok: false, error: "invalid_drawing" };
      const cleanMessage = sanitizeMessage(message);
      if (cleanMessage === null) return { ok: false, error: "invalid_message" };

      try {
        const { data, error } = await getClient()
          .from("fireworks")
          .insert({
            drawing_data: cleanDrawing,
            message: cleanMessage,
            status: "approved",
          })
          .select("id")
          .single<{ id: string }>();
        if (error || !data) {
          return { ok: false, error: error?.message ?? "submit_failed" };
        }
        return { ok: true, id: data.id };
      } catch {
        return { ok: false, error: "network_error" };
      }
    },

    async fetchNext(count: number): Promise<FireworkRecord[]> {
      const n = Math.max(1, Math.floor(count));
      try {
        const supabase = getClient();
        const { data, error } = await supabase
          .from("fireworks")
          .select("*")
          .eq("status", "approved")
          .order("shown_count", { ascending: true })
          .order("last_shown_at", { ascending: true, nullsFirst: true })
          .limit(Math.max(n * 3, 10));
        if (error || !data || data.length === 0) return [];

        // 同順位はランダムに崩す (仕様 §31)
        const rows = (data as FireworkRow[]).map((r) => ({
          r,
          rand: Math.random(),
        }));
        rows.sort((a, b) => {
          const ac = a.r.shown_count ?? 0;
          const bc = b.r.shown_count ?? 0;
          if (ac !== bc) return ac - bc;
          const at = a.r.last_shown_at ? Date.parse(a.r.last_shown_at) : -1;
          const bt = b.r.last_shown_at ? Date.parse(b.r.last_shown_at) : -1;
          if (at !== bt) return at - bt;
          return a.rand - b.rand;
        });

        const picked = rows.slice(0, n).map((x) => x.r);
        const now = new Date().toISOString();
        await Promise.all(
          picked.map((row) =>
            supabase
              .from("fireworks")
              .update({
                shown_count: (row.shown_count ?? 0) + 1,
                last_shown_at: now,
              })
              .eq("id", row.id)
              .then(
                () => undefined,
                () => undefined,
              ),
          ),
        );

        return picked.map((row) =>
          toRecord({
            ...row,
            shown_count: (row.shown_count ?? 0) + 1,
            last_shown_at: now,
          }),
        );
      } catch {
        return [];
      }
    },

    subscribeNewFireworks(cb: (fw: FireworkRecord) => void): () => void {
      const supabase = getClient();
      const channel = supabase
        .channel(channelName("hanabi-fireworks"))
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "fireworks" },
          (payload) => {
            const row = payload.new as FireworkRow;
            if (row && row.status === "approved") cb(toRecord(row));
          },
        )
        .subscribe();
      return () => {
        void supabase.removeChannel(channel);
      };
    },

    async getSettings(): Promise<ScreenSettings> {
      try {
        return await readSettings(getClient());
      } catch {
        return { ...DEFAULT_SETTINGS };
      }
    },

    async updateSettings(patch: Partial<ScreenSettings>): Promise<ScreenSettings> {
      const cleanPatch = sanitizeSettingsPatch(patch);
      const supabase = getClient();
      const current = await readSettings(supabase);
      const next: ScreenSettings = { ...current, ...cleanPatch };
      const { error } = await supabase
        .from("screen_settings")
        .upsert({ id: 1, data: next });
      // 管理画面が「保存済み」を誤表示しないよう、失敗は throw で伝える
      if (error) throw new Error(error.message);
      return next;
    },

    subscribeSettings(cb: (s: ScreenSettings) => void): () => void {
      const supabase = getClient();
      const channel = supabase
        .channel(channelName("hanabi-settings"))
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "screen_settings" },
          (payload) => {
            const row = payload.new as SettingsRow;
            cb({ ...DEFAULT_SETTINGS, ...(row?.data ?? {}) });
          },
        )
        .subscribe();
      return () => {
        void supabase.removeChannel(channel);
      };
    },

    async listAll(): Promise<FireworkRecord[]> {
      try {
        const { data, error } = await getClient()
          .from("fireworks")
          .select("*")
          .order("created_at", { ascending: false });
        if (error || !data) return [];
        return (data as FireworkRow[]).map(toRecord);
      } catch {
        return [];
      }
    },

    async setStatus(id: string, status: FireworkStatus): Promise<void> {
      // 管理画面がロールバック/エラー表示できるよう、失敗は throw で伝える
      const { error } = await getClient()
        .from("fireworks")
        .update({ status })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },

    async deleteAll(): Promise<void> {
      // supabase の delete はフィルタ必須のため、全行に一致する条件を付ける
      const { error } = await getClient()
        .from("fireworks")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw new Error(error.message);
    },
  };
}
