import type { FireworksAudioApi } from "@/types";
import { createAmbience, type AmbienceHandle } from "./ambience";
import { buildGraph, type AudioGraph } from "./graph";
import * as synths from "./synths";

/**
 * 完全手続き生成の WebAudio 花火サウンドエンジン。
 * AudioContext は最初の resume() (ユーザージェスチャー後) まで生成しない — SSR 安全。
 * resume() 前・suspend/close 中の play* はすべて安全な no-op。
 */
export function createFireworksAudio(): FireworksAudioApi {
  let graph: AudioGraph | null = null;
  let ambience: AmbienceHandle | null = null;
  // resume() 前に startAmbience() された場合に備えて希望状態を覚えておく
  let ambienceRequested = false;
  let volume = 1;

  const ready = (): AudioGraph | null =>
    graph !== null && graph.ctx.state === "running" ? graph : null;

  return {
    async resume() {
      if (typeof window === "undefined") return;
      if (graph && graph.ctx.state === "closed") {
        graph = null;
        ambience = null;
      }
      if (!graph) {
        const Ctor =
          window.AudioContext ??
          (window as Window & { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) return;
        const g = buildGraph(new Ctor());
        g.master.gain.value = volume * volume;
        graph = g;
        ambience = createAmbience(g);
      }
      if (graph.ctx.state === "suspended") {
        try {
          await graph.ctx.resume();
        } catch {
          // 自動再生ポリシー等で失敗したら次のジェスチャーまで待つ
          return;
        }
      }
      if (ambienceRequested) ambience?.start();
    },

    setVolume(v: number) {
      volume = Math.min(1, Math.max(0, v));
      if (!graph) return;
      const gain = graph.master.gain;
      const t = graph.ctx.currentTime;
      gain.cancelScheduledValues(t);
      gain.setValueAtTime(gain.value, t);
      // 知覚に合わせ v^2 へ 50ms でランプ (ザッピングノイズ防止)
      gain.linearRampToValueAtTime(volume * volume, t + 0.05);
    },

    playLaunch() {
      const g = ready();
      if (g) synths.playLaunch(g);
    },

    playBurst(size: number) {
      const g = ready();
      if (g) synths.playBurst(g, size);
    },

    playCrackle() {
      const g = ready();
      if (g) synths.playCrackle(g);
    },

    startAmbience() {
      ambienceRequested = true;
      if (ready()) ambience?.start();
    },

    stopAmbience() {
      ambienceRequested = false;
      ambience?.stop();
    },
  };
}
