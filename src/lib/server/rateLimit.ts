/**
 * 投稿のレート制限 (仕様 §45): IP ごとのスライディングウィンドウ。
 * 60秒あたり最大6投稿、かつ連続投稿は1.5秒以上あける。
 * dev ホットリロードをまたいで状態を保つため globalThis 単一インスタンス。
 *
 * 注意: X-Forwarded-For はクライアントが偽装できるため、IP 別制限は
 * 善意の利用者向けの調整にすぎない。偽装フラッドの被害を抑えるため、
 * IP に依存しない全体スライディングウィンドウを併設する。
 */

const WINDOW_MS = 60_000;
const MAX_POSTS_PER_WINDOW = 6;
const MIN_GAP_MS = 1_500;
/** 全 IP 合計の 60 秒あたり上限 (会場規模でも十分、フラッドは頭打ちにする) */
const GLOBAL_MAX_PER_WINDOW = 120;
/** Map が肥大化したら古いエントリを掃除する閾値 */
const PRUNE_THRESHOLD = 1_000;
/** 掃除後もこれを超えるなら最古から強制的に落とす (偽装 IP 大量流入対策) */
const HARD_CAP = 5_000;

interface RateState {
  hits: Map<string, number[]>;
  globalHits: number[];
}

const g = globalThis as typeof globalThis & { __hanabiRate?: RateState };

function getState(): RateState {
  if (!g.__hanabiRate) {
    g.__hanabiRate = { hits: new Map(), globalHits: [] };
  }
  // dev ホットリロードで旧構造の globalThis が残っていても壊れないように
  g.__hanabiRate.globalHits ??= [];
  return g.__hanabiRate;
}

export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return "local";
}

/** 投稿を許可するなら true (許可時はヒットを記録する) */
export function allowPost(ip: string): boolean {
  const state = getState();
  const now = Date.now();

  // IP に依存しない全体上限 (XFF 偽装でも突破できない)
  state.globalHits = state.globalHits.filter((t) => now - t < WINDOW_MS);
  if (state.globalHits.length >= GLOBAL_MAX_PER_WINDOW) return false;

  if (state.hits.size > PRUNE_THRESHOLD) {
    for (const [key, times] of state.hits) {
      if (times.length === 0 || now - times[times.length - 1] > WINDOW_MS) {
        state.hits.delete(key);
      }
    }
    // 偽装 IP の大量流入でも Map を無限に育てない
    if (state.hits.size > HARD_CAP) {
      const excess = state.hits.size - HARD_CAP;
      let i = 0;
      for (const key of state.hits.keys()) {
        if (i++ >= excess) break;
        state.hits.delete(key);
      }
    }
  }

  const times = (state.hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  const last = times[times.length - 1];

  if (times.length >= MAX_POSTS_PER_WINDOW) {
    state.hits.set(ip, times);
    return false;
  }
  if (last !== undefined && now - last < MIN_GAP_MS) {
    state.hits.set(ip, times);
    return false;
  }

  times.push(now);
  state.hits.set(ip, times);
  state.globalHits.push(now);
  return true;
}
