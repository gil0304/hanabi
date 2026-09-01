/** ノイズバッファ生成 — 音源ファイルは一切使わず全て手続き生成する */

/** 全サウンドで再利用するホワイトノイズ (既定 2 秒・モノラル) */
export function createNoiseBuffer(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/**
 * コンボルバ用インパルス応答: 指数減衰するステレオノイズ。
 * 夜空の残響 (遠くの山びこ) を安価に再現する。
 */
export function createImpulseResponse(
  ctx: BaseAudioContext,
  seconds = 1.8,
  decay = 3.2,
): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      // t=seconds で約 e^-decay ≒ 0.04 まで減衰
      data[i] = (Math.random() * 2 - 1) * Math.exp((-decay * i) / length);
    }
  }
  return buffer;
}
