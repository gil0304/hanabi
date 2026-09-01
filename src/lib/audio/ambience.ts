import type { AudioGraph } from "./graph";
import { rand, randInt } from "./random";

/**
 * 夜の環境音: 夜気ノイズ + コオロギ + ごく薄い祭の気配 (遠い太鼓)。
 * 花火の下で消える程度の極小レベルに揃える。
 * 繰り返しイベントは setTimeout チェーンで駆動し、stop() で全て解除する。
 */
export interface AmbienceHandle {
  start(): void;
  stop(): void;
}

export function createAmbience(g: AudioGraph): AmbienceHandle {
  const { ctx } = g;
  let running = false;
  let ambGain: GainNode | null = null;
  let bedSrc: AudioBufferSourceNode | null = null;
  let cricketTimer: ReturnType<typeof setTimeout> | null = null;
  let taikoTimer: ReturnType<typeof setTimeout> | null = null;

  /** コオロギ: FM で羽音のざらつきを付けた短いチャープの連なり */
  function chirpCluster(out: AudioNode): void {
    const t0 = ctx.currentTime + 0.02;
    const chirps = randInt(3, 7);
    const spacing = rand(0.07, 0.12);
    const end = t0 + chirps * spacing + 0.1;

    const carrier = ctx.createOscillator();
    carrier.type = "sine";
    carrier.frequency.value = rand(3900, 4700);
    carrier.detune.value = rand(-18, 18);

    const mod = ctx.createOscillator();
    mod.type = "sine";
    mod.frequency.value = rand(24, 42);
    const modGain = ctx.createGain();
    modGain.gain.value = rand(120, 350);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);

    const gain = ctx.createGain();
    const peak = rand(0.003, 0.007);
    gain.gain.setValueAtTime(0, t0);
    for (let i = 0; i < chirps; i++) {
      const t = t0 + i * spacing;
      gain.gain.linearRampToValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peak, t + spacing * 0.3);
      gain.gain.linearRampToValueAtTime(0, t + spacing * 0.7);
    }

    const pan = ctx.createStereoPanner();
    pan.pan.value = rand(-0.6, 0.6);
    carrier.connect(gain);
    gain.connect(pan);
    pan.connect(out);
    carrier.start(t0);
    mod.start(t0);
    carrier.stop(end);
    mod.stop(end);
    carrier.onended = () => {
      carrier.disconnect();
      mod.disconnect();
      modGain.disconnect();
      gain.disconnect();
      pan.disconnect();
    };
  }

  /** 遠い太鼓のような低い一打 */
  function thump(out: AudioNode, t: number, peak: number): void {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const f = rand(52, 68);
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.25);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 160;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + rand(0.4, 0.6));

    osc.connect(lp);
    lp.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + 0.7);
    osc.onended = () => {
      osc.disconnect();
      lp.disconnect();
      gain.disconnect();
    };
  }

  /** 祭の気配: ドン、ドン と二打 */
  function taikoPair(out: AudioNode): void {
    const base = ctx.currentTime + 0.05;
    thump(out, base, rand(0.014, 0.022));
    thump(out, base + rand(0.28, 0.42), rand(0.01, 0.016));
  }

  function scheduleCricket(): void {
    cricketTimer = setTimeout(() => {
      if (!running || !ambGain) return;
      chirpCluster(ambGain);
      scheduleCricket();
    }, rand(2000, 9000));
  }

  function scheduleTaiko(): void {
    taikoTimer = setTimeout(() => {
      if (!running || !ambGain) return;
      taikoPair(ambGain);
      scheduleTaiko();
    }, rand(25000, 60000));
  }

  return {
    start() {
      if (running) return;
      running = true;
      const t0 = ctx.currentTime;

      const out = ctx.createGain();
      out.gain.setValueAtTime(0, t0);
      out.gain.linearRampToValueAtTime(1, t0 + 1.5);
      out.connect(g.bus);
      ambGain = out;

      // 夜気: ごく低いローパスノイズの床
      const src = ctx.createBufferSource();
      src.buffer = g.noise;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 350;
      const bedGain = ctx.createGain();
      bedGain.gain.value = 0.008;
      src.connect(lp);
      lp.connect(bedGain);
      bedGain.connect(out);
      src.start(t0);
      bedSrc = src;

      scheduleCricket();
      scheduleTaiko();
    },

    stop() {
      if (!running) return;
      running = false;
      if (cricketTimer !== null) clearTimeout(cricketTimer);
      if (taikoTimer !== null) clearTimeout(taikoTimer);
      cricketTimer = null;
      taikoTimer = null;

      const out = ambGain;
      const src = bedSrc;
      ambGain = null;
      bedSrc = null;
      if (!out) return;

      const t = ctx.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + 1);
      if (src) {
        src.stop(t + 1.05);
        src.onended = () => out.disconnect();
      } else {
        out.disconnect();
      }
    },
  };
}
