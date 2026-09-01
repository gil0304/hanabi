import type { AudioGraph } from "./graph";
import { chance, jitter, rand, randInt } from "./random";

/**
 * 花火の単発サウンド群。毎回パラメータを揺らし、同じ音を二度鳴らさない (仕様 §36-38)。
 * すべて AudioContext 時刻でエンベロープをスケジュールし、終了時にノードを切断する。
 */

function noiseSource(g: AudioGraph, loop = true): AudioBufferSourceNode {
  const src = g.ctx.createBufferSource();
  src.buffer = g.noise;
  src.loop = loop;
  return src;
}

/** src → nodes → panner → bus を接続し、src 終了時に全ノードを切断する */
function connectChain(
  g: AudioGraph,
  src: AudioScheduledSourceNode,
  nodes: AudioNode[],
  panValue: number,
): void {
  const pan = g.ctx.createStereoPanner();
  pan.pan.value = panValue;
  let prev: AudioNode = src;
  for (const n of nodes) {
    prev.connect(n);
    prev = n;
  }
  prev.connect(pan);
  pan.connect(g.bus);
  src.onended = () => {
    src.disconnect();
    for (const n of nodes) n.disconnect();
    pan.disconnect();
  };
}

/** ヒュー — 上昇の口笛。狭帯域バンドパスを掃引したノイズ + 時々かすかな正弦波 */
export function playLaunch(g: AudioGraph): void {
  const { ctx } = g;
  const t0 = ctx.currentTime;
  const dur = rand(1.2, 1.8);
  const f0 = 250 * jitter(0.2);
  const f1 = 900 * jitter(0.2);
  const panValue = rand(-0.2, 0.2);
  const peak = rand(0.045, 0.075); // アクセントなので控えめに

  const src = noiseSource(g);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = rand(10, 16);
  bp.frequency.setValueAtTime(f0, t0);
  bp.frequency.exponentialRampToValueAtTime(f1, t0 + dur);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + dur * 0.35);
  gain.gain.linearRampToValueAtTime(peak * 0.55, t0 + dur * 0.8);
  gain.gain.linearRampToValueAtTime(0, t0 + dur);

  connectChain(g, src, [bp, gain], panValue);
  src.start(t0, rand(0, 1));
  src.stop(t0 + dur + 0.05);

  if (chance(0.5)) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t0);
    og.gain.linearRampToValueAtTime(peak * 0.35, t0 + dur * 0.4);
    og.gain.linearRampToValueAtTime(0, t0 + dur);
    connectChain(g, osc, [og], panValue);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
}

/** ドン — 低域の胴体。爆発の重さは size に比例 */
function subThump(g: AudioGraph, t0: number, size: number, panValue: number): void {
  const { ctx } = g;
  const osc = ctx.createOscillator();
  osc.type = chance(0.5) ? "sine" : "triangle";
  const f = rand(45, 85);
  osc.frequency.setValueAtTime(f, t0);
  osc.frequency.exponentialRampToValueAtTime(f * rand(0.5, 0.65), t0 + rand(0.08, 0.15));

  const dur = 0.5 * jitter(0.2);
  const peak = (0.18 + 0.5 * size) * jitter(0.15);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peak, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  gain.gain.linearRampToValueAtTime(0, t0 + dur + 0.02);

  connectChain(g, osc, [gain], panValue * 0.5);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** 爆発本体: ローパスの開きが時間とともに閉じるノイズバースト (エコーにも再利用) */
function bodyLayer(
  g: AudioGraph,
  t0: number,
  size: number,
  panValue: number,
  cutoffScale: number,
  levelScale: number,
): void {
  const { ctx } = g;
  const dur = (0.7 + 0.8 * size) * jitter(0.2);
  const cutoff = Math.max(120, (250 + 1250 * size) * jitter(0.2) * cutoffScale);
  const peak = (0.14 + 0.5 * size) * jitter(0.2) * levelScale;

  const src = noiseSource(g);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 0.7;
  lp.frequency.setValueAtTime(cutoff, t0);
  lp.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.12), t0 + dur);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  gain.gain.linearRampToValueAtTime(0, t0 + dur + 0.02);

  connectChain(g, src, [lp, gain], panValue);
  src.start(t0, rand(0, 1));
  src.stop(t0 + dur + 0.05);
}

/** バリッ — 立ち上がりの高域トランジェント (10-20ms) */
function crackLayer(g: AudioGraph, t0: number, panValue: number): void {
  const { ctx } = g;
  const dur = rand(0.01, 0.02);
  const src = noiseSource(g, false);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = rand(2500, 5000);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(rand(0.12, 0.2), t0);
  gain.gain.linearRampToValueAtTime(0, t0 + dur);

  connectChain(g, src, [hp, gain], panValue);
  src.start(t0, rand(0, 1.5), dur + 0.01);
}

/** 爆発音 — 低域ドン + ノイズ胴体 + 高域トランジェント (+ 30% で遠雷エコー) */
export function playBurst(g: AudioGraph, size: number): void {
  const s = Math.min(1, Math.max(0, size));
  const t0 = g.ctx.currentTime;
  const panValue = rand(-0.4, 0.4);

  subThump(g, t0, s, panValue);
  bodyLayer(g, t0, s, panValue, 1, 1);
  crackLayer(g, t0, panValue);

  if (chance(0.3)) {
    // 遠くの反響: 少し遅れて、こもって小さく、逆側から
    bodyLayer(g, t0 + rand(0.22, 0.3), s, panValue * -0.6, 0.35, 0.18);
  }
}

/** パチパチ — 高域ノイズ粒を減衰する密度でばら撒く */
export function playCrackle(g: AudioGraph): void {
  const { ctx } = g;
  const t0 = ctx.currentTime;
  const count = randInt(12, 35);
  const total = rand(0.7, 1.6);

  for (let i = 0; i < count; i++) {
    // pow(u, 1.8) で発生時刻を前半に偏らせる (火の粉は最初ほど多い)
    const at = total * Math.pow(Math.random(), 1.8);
    const dur = rand(0.004, 0.012);
    const t = t0 + at;
    const peak = rand(0.015, 0.045) * (1 - (at / total) * 0.6);

    const src = noiseSource(g, false);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = rand(3000, 9000);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.001);
    gain.gain.linearRampToValueAtTime(0, t + dur);

    connectChain(g, src, [hp, gain], rand(-0.5, 0.5));
    src.start(t, rand(0, 1.5), dur + 0.005);
  }
}
