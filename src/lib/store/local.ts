import {
  DEFAULT_SETTINGS,
  type DrawingData,
  type FireworkRecord,
  type FireworkStatus,
  type ScreenSettings,
} from "@/types";
import { sanitizeDrawing, sanitizeMessage } from "@/lib/server/validate";
import type { FireworkStore, SubmitResult } from "./types";

/**
 * ローカルバックエンド (Next.js API Route + ファイル永続化 + SSE) を
 * fetch() で叩く FireworkStore 実装。Supabase 環境変数未設定時のデフォルト。
 */

type FireworkCb = (fw: FireworkRecord) => void;
type SettingsCb = (s: ScreenSettings) => void;

// SSE は全購読者で1本の EventSource を共有する
const fireworkCbs = new Set<FireworkCb>();
const settingsCbs = new Set<SettingsCb>();
let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function hasListeners(): boolean {
  return fireworkCbs.size > 0 || settingsCbs.size > 0;
}

function ensureStream(): void {
  if (eventSource || typeof window === "undefined") return;
  const es = new EventSource("/api/stream");
  eventSource = es;

  es.addEventListener("firework", (e) => {
    try {
      const record = JSON.parse((e as MessageEvent<string>).data) as FireworkRecord;
      for (const cb of fireworkCbs) cb(record);
    } catch {
      // 不正な JSON は無視
    }
  });

  es.addEventListener("settings", (e) => {
    try {
      const raw = JSON.parse(
        (e as MessageEvent<string>).data,
      ) as Partial<ScreenSettings>;
      const settings: ScreenSettings = { ...DEFAULT_SETTINGS, ...raw };
      for (const cb of settingsCbs) cb(settings);
    } catch {
      // 不正な JSON は無視
    }
  });

  es.onerror = () => {
    // 通常の切断は EventSource が自動再接続する。
    // 完全に閉じられた場合のみ自前で張り直す。
    if (es.readyState === EventSource.CLOSED && hasListeners()) {
      eventSource = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (hasListeners()) ensureStream();
      }, 3000);
    }
  };
}

function closeStreamIfIdle(): void {
  if (!hasListeners()) {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }
}

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(input, init);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function createLocalStore(): FireworkStore {
  return {
    async submitFirework(
      drawing: DrawingData,
      message: string,
    ): Promise<SubmitResult> {
      // サーバー側でも検証するが、店側でも契約を守る
      const cleanDrawing = sanitizeDrawing(drawing);
      if (!cleanDrawing) return { ok: false, error: "invalid_drawing" };
      const cleanMessage = sanitizeMessage(message);
      if (cleanMessage === null) return { ok: false, error: "invalid_message" };

      try {
        const res = await fetch("/api/fireworks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            drawing_data: cleanDrawing,
            message: cleanMessage,
          }),
        });
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          id?: string;
          error?: string;
        } | null;
        if (res.ok && body?.ok && typeof body.id === "string") {
          return { ok: true, id: body.id };
        }
        return { ok: false, error: body?.error ?? "submit_failed" };
      } catch {
        return { ok: false, error: "network_error" };
      }
    },

    async fetchNext(count: number): Promise<FireworkRecord[]> {
      const data = await jsonFetch<FireworkRecord[]>("/api/fireworks/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count }),
      });
      return Array.isArray(data) ? data : [];
    },

    subscribeNewFireworks(cb: FireworkCb): () => void {
      fireworkCbs.add(cb);
      ensureStream();
      return () => {
        fireworkCbs.delete(cb);
        closeStreamIfIdle();
      };
    },

    async getSettings(): Promise<ScreenSettings> {
      const data = await jsonFetch<Partial<ScreenSettings>>("/api/settings");
      return data ? { ...DEFAULT_SETTINGS, ...data } : { ...DEFAULT_SETTINGS };
    },

    async updateSettings(patch: Partial<ScreenSettings>): Promise<ScreenSettings> {
      const data = await jsonFetch<Partial<ScreenSettings>>("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      // 管理画面が「保存済み」を誤表示しないよう、失敗は throw で伝える
      if (!data) throw new Error("update_settings_failed");
      return { ...DEFAULT_SETTINGS, ...data };
    },

    subscribeSettings(cb: SettingsCb): () => void {
      settingsCbs.add(cb);
      ensureStream();
      return () => {
        settingsCbs.delete(cb);
        closeStreamIfIdle();
      };
    },

    async listAll(): Promise<FireworkRecord[]> {
      const data = await jsonFetch<FireworkRecord[]>("/api/fireworks?scope=all");
      return Array.isArray(data) ? data : [];
    },

    async setStatus(id: string, status: FireworkStatus): Promise<void> {
      // 管理画面がロールバック/エラー表示できるよう、失敗は throw で伝える
      const res = await jsonFetch(`/api/fireworks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res === null) throw new Error("set_status_failed");
    },

    async deleteAll(): Promise<void> {
      const res = await jsonFetch("/api/fireworks", { method: "DELETE" });
      if (res === null) throw new Error("delete_all_failed");
    },
  };
}
