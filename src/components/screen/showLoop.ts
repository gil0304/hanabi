import { getSeedRecords } from "@/lib/seed";
import type { FireworkRecord, ScreenSettings } from "@/types";
import type {
  FireworksRenderer,
  LaunchHeight,
  LaunchOptions,
} from "@/lib/fireworks/types";

/** 打ち上げ間隔の揺らぎ (仕様 §30: interval × 0.7〜1.7) */
const INTERVAL_JITTER_MIN = 0.7;
const INTERVAL_JITTER_MAX = 1.7;
/** ボレー内の各発の時間差 (ms) */
const STAGGER_MIN_MS = 250;
const STAGGER_MAX_MS = 700;
/** ループ開始直後、最初の1発までの待ち (ms) */
const FIRST_SHOT_DELAY_MS = 700;

type Zone = "left" | "center" | "right";

const ZONES: readonly Zone[] = ["left", "center", "right"];

const ZONE_RANGES: Record<Zone, [number, number]> = {
  left: [0.1, 0.32],
  center: [0.4, 0.6],
  right: [0.68, 0.9],
};

const HEIGHTS: readonly LaunchHeight[] = ["low", "medium", "high"];

export interface ShowLoopDeps {
  renderer: FireworksRenderer;
  fetchNext: (count: number) => Promise<FireworkRecord[]>;
  /** 常に最新の設定を返すこと (ref 経由で読む) */
  getSettings: () => ScreenSettings;
}

export interface ShowLoop {
  start(): void;
  stop(): void;
  /** 投稿直後の花火を積む。次のボレーの先頭で打ち上がる (仕様 §32) */
  pushPriority(record: FireworkRecord): void;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function shuffle<T>(src: readonly T[]): T[] {
  const arr = [...src];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** ボレー発数: 60% → 1発, 30% → 2発, 10% → 3発 (仕様 §33)。設定の上限でキャップ */
function pickVolleySize(max: number): number {
  const r = Math.random();
  const size = r < 0.6 ? 1 : r < 0.9 ? 2 : 3;
  return Math.min(size, max);
}

/**
 * エンドレスショーのスケジューラ (仕様 §29〜§34)。
 * 例外は必ず握りつぶしてループを継続する。
 */
export function createShowLoop(deps: ShowLoopDeps): ShowLoop {
  let running = false;
  let mainTimer: number | undefined;
  const staggerTimers = new Set<number>();

  /** 投稿直後キュー。FIFO・1ボレーにつき1発だけ消費 (新着を際立たせる) */
  const priorityQueue: FireworkRecord[] = [];
  /** リアルタイム購読の再接続などによる重複配信を除外する */
  const seenIds = new Set<string>();

  /**
   * 直近に打ち上げた投稿の再登板を抑える。
   * 優先キュー経由の1発は shown_count が増えないため、直後の fetchNext が
   * 同じ花火を返してボレー内/直後に重複しうる — それをクライアント側で防ぐ。
   */
  const recentlyLaunched = new Map<string, number>();
  const RECENT_REPEAT_MS = 25_000;
  const markLaunched = (record: FireworkRecord): void => {
    recentlyLaunched.set(record.id, Date.now());
    if (recentlyLaunched.size > 200) {
      const cutoff = Date.now() - RECENT_REPEAT_MS;
      for (const [id, t] of recentlyLaunched) {
        if (t < cutoff) recentlyLaunched.delete(id);
      }
    }
  };
  const isRecent = (record: FireworkRecord): boolean => {
    const t = recentlyLaunched.get(record.id);
    return t !== undefined && Date.now() - t < RECENT_REPEAT_MS;
  };

  // 投稿0件時のフォールバック: シードをシャッフルして循環 (仕様 §34)
  let seedPool: FireworkRecord[] = [];
  let seedIndex = 0;
  const nextSeed = (): FireworkRecord => {
    if (seedIndex >= seedPool.length) {
      seedPool = shuffle(getSeedRecords());
      seedIndex = 0;
    }
    return seedPool[seedIndex++];
  };

  const safeLaunch = (record: FireworkRecord, opts: LaunchOptions): void => {
    try {
      markLaunched(record);
      deps.renderer.launch(record, opts);
    } catch {
      // 1発の失敗でショーは止めない
    }
  };

  const scheduleNext = (): void => {
    if (!running) return;
    const interval = clamp(deps.getSettings().fireworkInterval, 1, 10);
    const waitMs =
      interval * rand(INTERVAL_JITTER_MIN, INTERVAL_JITTER_MAX) * 1000;
    mainTimer = window.setTimeout(() => {
      void tick();
    }, waitMs);
  };

  const tick = async (): Promise<void> => {
    try {
      const settings = deps.getSettings();
      const maxConcurrent = clamp(Math.round(settings.concurrentFireworks), 1, 3);

      // 画面が花火で飽和していたら今回の打ち上げは見送る
      if (deps.renderer.activeCount() >= maxConcurrent + 1) return;

      const volley = pickVolleySize(maxConcurrent);
      const records: FireworkRecord[] = [];

      const fresh = priorityQueue.shift();
      if (fresh) {
        // shown_count が増えないうちに同 tick の fetchNext が同じ花火を
        // 返しうるため、fetch より前に「打ち上げ済み」として印を付ける
        markLaunched(fresh);
        records.push(fresh);
      }

      const need = volley - records.length;
      if (need > 0) {
        let fetched: FireworkRecord[] = [];
        try {
          fetched = await deps.fetchNext(need);
        } catch {
          fetched = [];
        }
        records.push(
          ...fetched
            .filter((r) => !isRecent(r) && !records.some((x) => x.id === r.id))
            .slice(0, need),
        );
      }
      if (!running) return;
      while (records.length < volley) records.push(nextSeed());

      // 同一ボレー内で同じ水平ゾーンを使い回さない
      const zones = shuffle(ZONES).slice(0, records.length);
      let delayMs = 0;
      records.forEach((record, i) => {
        const [lo, hi] = ZONE_RANGES[zones[i]];
        const opts: LaunchOptions = {
          x: rand(lo, hi),
          height: HEIGHTS[Math.floor(Math.random() * HEIGHTS.length)],
        };
        if (i === 0) {
          safeLaunch(record, opts);
          return;
        }
        delayMs += rand(STAGGER_MIN_MS, STAGGER_MAX_MS);
        const t = window.setTimeout(() => {
          staggerTimers.delete(t);
          safeLaunch(record, opts);
        }, delayMs);
        staggerTimers.add(t);
      });
    } catch {
      // どんな例外でもループは殺さない
    } finally {
      scheduleNext();
    }
  };

  return {
    start(): void {
      if (running) return;
      running = true;
      mainTimer = window.setTimeout(() => {
        void tick();
      }, FIRST_SHOT_DELAY_MS);
    },
    stop(): void {
      running = false;
      if (mainTimer !== undefined) window.clearTimeout(mainTimer);
      staggerTimers.forEach((t) => window.clearTimeout(t));
      staggerTimers.clear();
    },
    pushPriority(record: FireworkRecord): void {
      if (seenIds.has(record.id)) return;
      seenIds.add(record.id);
      priorityQueue.push(record);
      // 投稿ラッシュでも古い「新着」を延々と流さない (溢れた分は fetchNext 経由で出る)
      if (priorityQueue.length > 30) priorityQueue.shift();
    },
  };
}
