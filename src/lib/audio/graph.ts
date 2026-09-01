import { createImpulseResponse, createNoiseBuffer } from "./noise";

/**
 * 共有オーディオグラフ:
 *   各音源 → bus ─┬─ dry ──────────────┐
 *                 └─ wet(0.35) → 残響 ─┴→ コンプレッサ → master → 出力
 */
export interface AudioGraph {
  ctx: AudioContext;
  /** 全音源が接続する入力バス (dry とリバーブ send に分岐) */
  bus: GainNode;
  /** setVolume が操作する最終段 */
  master: GainNode;
  /** 2 秒ホワイトノイズ。全サウンドで再利用 */
  noise: AudioBuffer;
}

export function buildGraph(ctx: AudioContext): AudioGraph {
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  // 大きな爆発が重なってもクリップしないよう軽く潰す
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 24;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  comp.connect(master);

  const dry = ctx.createGain();
  dry.gain.value = 1;
  dry.connect(comp);

  const convolver = ctx.createConvolver();
  convolver.buffer = createImpulseResponse(ctx, 1.8);
  convolver.connect(comp);

  const wet = ctx.createGain();
  wet.gain.value = 0.35;
  wet.connect(convolver);

  const bus = ctx.createGain();
  bus.gain.value = 1;
  bus.connect(dry);
  bus.connect(wet);

  return { ctx, bus, master, noise: createNoiseBuffer(ctx, 2) };
}
