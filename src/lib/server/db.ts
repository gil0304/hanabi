import { promises as fs, mkdirSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  DEFAULT_SETTINGS,
  type DrawingData,
  type FireworkRecord,
  type FireworkStatus,
  type ScreenSettings,
} from "@/types";

/**
 * ローカルバックエンドの永続化層。
 * メモリ上の配列を正とし、.data/fireworks.json へデバウンス書き込みする。
 * dev のホットリロードや複数の Route モジュール間で単一インスタンスを
 * 共有するため globalThis に載せる。
 */

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "fireworks.json");
const SAVE_DEBOUNCE_MS = 500;
/** 変更が続いてもこの時間を超えて保存を先送りしない (デバウンス無限延期の防止) */
const MAX_SAVE_WAIT_MS = 2000;

interface PersistShape {
  fireworks: FireworkRecord[];
  settings: ScreenSettings;
}

interface DbState {
  loaded: boolean;
  loadPromise: Promise<void> | null;
  fireworks: FireworkRecord[];
  settings: ScreenSettings;
  saveTimer: ReturnType<typeof setTimeout> | null;
  /** 書き込みを直列化するためのチェーン */
  saveChain: Promise<void>;
  /** 未保存の変更があるか */
  dirty: boolean;
  /** 未保存変更の最初の発生時刻 (max-wait 判定用) */
  firstPendingAt: number | null;
  /** 終了時フラッシュを登録済みか */
  exitHooked: boolean;
}

const g = globalThis as typeof globalThis & { __hanabiDb?: DbState };

function getState(): DbState {
  if (!g.__hanabiDb) {
    g.__hanabiDb = {
      loaded: false,
      loadPromise: null,
      // シードは DB に入れない (0件時はスクリーン側がクライアントでフォールバック)
      fireworks: [],
      settings: { ...DEFAULT_SETTINGS },
      saveTimer: null,
      saveChain: Promise.resolve(),
      dirty: false,
      firstPendingAt: null,
      exitHooked: false,
    };
  }
  // dev ホットリロードで旧構造の globalThis が残っていても壊れないように
  const state = g.__hanabiDb;
  state.dirty ??= false;
  state.firstPendingAt ??= null;
  state.exitHooked ??= false;
  hookExitFlush(state);
  return state;
}

/** プロセス終了時に未保存の変更を同期書き込みで残す */
function hookExitFlush(state: DbState): void {
  if (state.exitHooked) return;
  state.exitHooked = true;
  const flushSync = (): void => {
    // 非同期保存の途中で落ちても取りこぼさないよう、ロード済みなら常に書く
    // (アトミック rename なので同一内容の再書き込みは無害)
    if (!state.loaded) return;
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      const tmp = `${DATA_FILE}.tmp`;
      writeFileSync(
        tmp,
        JSON.stringify({ fireworks: state.fireworks, settings: state.settings }),
        "utf8",
      );
      renameSync(tmp, DATA_FILE);
      state.dirty = false;
    } catch {
      // 終了間際の失敗は諦める
    }
  };
  process.on("exit", flushSync);
  process.on("beforeExit", flushSync);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      flushSync();
      // 他にハンドラが居なければ既定動作 (終了) を自前で行う
      if (process.listenerCount(sig) === 0) process.exit(sig === "SIGINT" ? 130 : 143);
    });
  }
}

async function ensureLoaded(state: DbState): Promise<void> {
  if (state.loaded) return;
  if (!state.loadPromise) {
    state.loadPromise = (async () => {
      try {
        const raw = await fs.readFile(DATA_FILE, "utf8");
        const parsed = JSON.parse(raw) as Partial<PersistShape>;
        if (Array.isArray(parsed.fireworks)) {
          state.fireworks = parsed.fireworks;
        }
        if (parsed.settings && typeof parsed.settings === "object") {
          state.settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
        }
      } catch {
        // ファイル無し/破損時は空で開始
      }
      state.loaded = true;
    })();
  }
  await state.loadPromise;
}

function runSave(state: DbState): void {
  state.saveTimer = null;
  state.firstPendingAt = null;
  state.dirty = false;
  state.saveChain = state.saveChain.then(async () => {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const json = JSON.stringify(
        { fireworks: state.fireworks, settings: state.settings },
        null,
        2,
      );
      // tmp に書いて rename (途中クラッシュでファイルが壊れないように)
      const tmp = `${DATA_FILE}.tmp`;
      await fs.writeFile(tmp, json, "utf8");
      await fs.rename(tmp, DATA_FILE);
    } catch {
      // 書き込み失敗は無視 (次回の保存で回復)
      state.dirty = true;
    }
  });
}

function scheduleSave(state: DbState): void {
  const now = Date.now();
  state.dirty = true;
  if (state.firstPendingAt === null) state.firstPendingAt = now;

  // 変更が連続してもデバウンスを無限に延期しない:
  // 最初の未保存変更から MAX_SAVE_WAIT_MS 経過していたら即座に保存する
  if (now - state.firstPendingAt >= MAX_SAVE_WAIT_MS) {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    runSave(state);
    return;
  }
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => runSave(state), SAVE_DEBOUNCE_MS);
}

// ---- fireworks ----

export async function createFirework(
  drawing_data: DrawingData,
  message: string,
): Promise<FireworkRecord> {
  const state = getState();
  await ensureLoaded(state);
  const record: FireworkRecord = {
    id: randomUUID(),
    drawing_data,
    message,
    created_at: new Date().toISOString(),
    status: "approved",
    shown_count: 0,
    last_shown_at: null,
  };
  // 配列は新しい順で保持する
  state.fireworks.unshift(record);
  // 洪水時でもメモリ/ファイルを無限に育てない (最新を残して最古を落とす)
  if (state.fireworks.length > 20_000) state.fireworks.length = 20_000;
  scheduleSave(state);
  return record;
}

/** 全件 (新しい順)。管理画面用 */
export async function listFireworks(): Promise<FireworkRecord[]> {
  const state = getState();
  await ensureLoaded(state);
  return state.fireworks.map((f) => ({ ...f }));
}

/**
 * 打ち上げ優先順位付き取得 (仕様 §31):
 * approved のみ → shown_count 昇順 → last_shown_at 昇順(null 先頭) → ランダム。
 * 返す花火の shown_count / last_shown_at を更新する。
 */
export async function fetchNextFireworks(count: number): Promise<FireworkRecord[]> {
  const state = getState();
  await ensureLoaded(state);
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];

  const candidates = state.fireworks
    .filter((f) => f.status === "approved")
    .map((f) => ({ f, rand: Math.random() }));

  candidates.sort((a, b) => {
    if (a.f.shown_count !== b.f.shown_count) {
      return a.f.shown_count - b.f.shown_count;
    }
    // null (未表示) を最優先にする
    const at = a.f.last_shown_at ? Date.parse(a.f.last_shown_at) : -1;
    const bt = b.f.last_shown_at ? Date.parse(b.f.last_shown_at) : -1;
    if (at !== bt) return at - bt;
    return a.rand - b.rand;
  });

  const picked = candidates.slice(0, n).map((c) => c.f);
  const now = new Date().toISOString();
  for (const f of picked) {
    f.shown_count += 1;
    f.last_shown_at = now;
  }
  if (picked.length > 0) scheduleSave(state);
  return picked.map((f) => ({ ...f }));
}

export async function setFireworkStatus(
  id: string,
  status: FireworkStatus,
): Promise<FireworkRecord | null> {
  const state = getState();
  await ensureLoaded(state);
  const found = state.fireworks.find((f) => f.id === id);
  if (!found) return null;
  found.status = status;
  scheduleSave(state);
  return { ...found };
}

export async function deleteAllFireworks(): Promise<void> {
  const state = getState();
  await ensureLoaded(state);
  state.fireworks = [];
  scheduleSave(state);
}

// ---- settings ----

export async function getSettings(): Promise<ScreenSettings> {
  const state = getState();
  await ensureLoaded(state);
  return { ...state.settings };
}

/** patch は呼び出し側 (API Route) で検証済みであること */
export async function updateSettings(
  patch: Partial<ScreenSettings>,
): Promise<ScreenSettings> {
  const state = getState();
  await ensureLoaded(state);
  state.settings = { ...state.settings, ...patch };
  scheduleSave(state);
  return { ...state.settings };
}
