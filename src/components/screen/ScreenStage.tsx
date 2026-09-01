"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS } from "@/types";
import type { FireworksAudioApi, ScreenSettings } from "@/types";
import type {
  FireworksRenderer,
  FireworksRendererEvents,
} from "@/lib/fireworks/types";
import type { FireworkStore } from "@/lib/store/types";
import { createShowLoop, type ShowLoop } from "@/components/screen/showLoop";
import LanternRiver, {
  type LanternRiverHandle,
} from "@/components/screen/LanternRiver";
import QrCorner from "@/components/screen/QrCorner";
import StartOverlay from "@/components/screen/StartOverlay";
import styles from "@/components/screen/screen.module.css";

/** CSS の .overlay transition と揃える */
const OVERLAY_FADE_MS = 950;
/** 起動時に灯篭プールへ入れる直近の思い出の数 */
const LANTERN_SEED_COUNT = 14;
const CURSOR_HIDE_MS = 3000;

export default function ScreenStage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);

  const rendererRef = useRef<FireworksRenderer | null>(null);
  const audioRef = useRef<FireworksAudioApi | null>(null);
  const loopRef = useRef<ShowLoop | null>(null);
  const settingsRef = useRef<ScreenSettings>(DEFAULT_SETTINGS);
  const initPromiseRef = useRef<Promise<void> | null>(null);
  const startedRef = useRef(false);

  const lanternRef = useRef<LanternRiverHandle | null>(null);

  const [started, setStarted] = useState(false);
  const [overlayGone, setOverlayGone] = useState(false);
  const [messagesOn, setMessagesOn] = useState(DEFAULT_SETTINGS.messageVisible);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [submitHost, setSubmitHost] = useState<string | null>(null);
  const [qrVisible, setQrVisible] = useState(DEFAULT_SETTINGS.qrVisible);

  // ---- 設定の反映 (初回ロードとリアルタイム購読の両方から呼ばれる) ----
  const applySettings = useCallback((s: ScreenSettings) => {
    settingsRef.current = s;
    audioRef.current?.setVolume(Math.min(1, Math.max(0, s.soundVolume)));
    rendererRef.current?.setBackgroundMode(s.backgroundMode);
    setMessagesOn(s.messageVisible);
    setQrVisible(s.qrVisible);
  }, []);

  // ---- 初期化: レンダラー・音・ストアはブラウザ専用なので動的 import ----
  useEffect(() => {
    let cancelled = false;
    let unsubNew: (() => void) | undefined;
    let unsubSettings: (() => void) | undefined;

    initPromiseRef.current = (async () => {
      const host = canvasHostRef.current;
      if (!host) return;

      const [fireworksMod, audioMod, storeMod] = await Promise.all([
        import("@/lib/fireworks"),
        import("@/lib/audio"),
        import("@/lib/store/client"),
      ]);
      if (cancelled) return;

      const audio = audioMod.createFireworksAudio();
      audioRef.current = audio;

      const events: FireworksRendererEvents = {
        onLaunch: () => audioRef.current?.playLaunch(),
        onBurst: (size: number) => {
          // 光ってから音が遅れて届く演出 (仕様 §20): 一部の爆発音だけ遅らせる
          if (Math.random() < 0.55) {
            const delay = 60 + Math.random() * 120;
            window.setTimeout(() => audioRef.current?.playBurst(size), delay);
          } else {
            audioRef.current?.playBurst(size);
          }
        },
        onCrackle: () => audioRef.current?.playCrackle(),
        onFireworkEnd: (record) => {
          if (!settingsRef.current.messageVisible) return;
          const text = record.message.trim();
          if (text.length > 0) lanternRef.current?.push(text);
        },
      };

      const renderer = fireworksMod.createFireworksRenderer(events);
      rendererRef.current = renderer;
      renderer.mount(host);

      const store: FireworkStore = storeMod.getStore();

      try {
        const s = await store.getSettings();
        if (!cancelled) applySettings(s);
      } catch {
        // 設定取得に失敗しても既定値で進行する
      }
      if (cancelled) return;

      const loop = createShowLoop({
        renderer,
        fetchNext: (count) => store.fetchNext(count),
        getSettings: () => settingsRef.current,
      });
      loopRef.current = loop;

      unsubNew = store.subscribeNewFireworks((fw) => loop.pushPriority(fw));
      unsubSettings = store.subscribeSettings((s) => applySettings(s));

      // 直近の思い出を灯篭プールへ (取得失敗は無視してよい)
      void store
        .listAll()
        .then((records) => {
          if (cancelled) return;
          const texts = records
            .filter(
              (r) => r.status === "approved" && r.message.trim().length > 0,
            )
            .slice(0, LANTERN_SEED_COUNT)
            .map((r) => r.message)
            .reverse();
          lanternRef.current?.seed(texts);
        })
        .catch(() => {});

      // 初期化完了より先にタップされていた場合はここで開始 (start は冪等)
      if (startedRef.current) loop.start();
    })().catch(() => {
      // 初期化に失敗しても画面自体は保つ
    });

    return () => {
      cancelled = true;
      unsubNew?.();
      unsubSettings?.();
      loopRef.current?.stop();
      loopRef.current = null;
      rendererRef.current?.dispose();
      rendererRef.current = null;
      try {
        audioRef.current?.stopAmbience();
      } catch {
        // 終了処理の失敗は無視
      }
      audioRef.current = null;
    };
  }, [applySettings]);

  // ---- 開始 (ユーザージェスチャー: 音声の自動再生制限をここで解除) ----
  const handleStart = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setStarted(true);
    window.setTimeout(() => setOverlayGone(true), OVERLAY_FADE_MS);

    void (async () => {
      try {
        await initPromiseRef.current;
      } catch {
        // 初期化失敗時もオーバーレイだけは閉じる
      }
      const audio = audioRef.current;
      if (audio) {
        try {
          await audio.resume();
          audio.setVolume(settingsRef.current.soundVolume);
          audio.startAmbience();
        } catch {
          // 音が出せなくてもショーは続行する
        }
      }
      loopRef.current?.start();
    })();
  }, []);

  // ---- カーソル自動非表示 (3秒間動きがなければ隠す, 仕様 §16) ----
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let timer: number | undefined;
    const wake = () => {
      el.style.cursor = "default";
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        el.style.cursor = "none";
      }, CURSOR_HIDE_MS);
    };
    el.addEventListener("mousemove", wake);
    wake();
    return () => {
      el.removeEventListener("mousemove", wake);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  // ---- 投稿ページQRの生成 ----
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // スクリーンをローカルで開きつつ投稿はトンネル公開URLに誘導したい場合、
        // /screen?submit=https://xxx.trycloudflare.com で QR の宛先を上書きできる
        const param = new URLSearchParams(window.location.search).get("submit");
        const origin =
          param && /^https?:\/\//.test(param)
            ? param.replace(/\/+$/, "")
            : window.location.origin;
        const qrcode = await import("qrcode");
        const url = await qrcode.toDataURL(`${origin}/`, {
          width: 220,
          margin: 1,
          color: { dark: "#060920", light: "#fff8f0" },
        });
        if (!cancelled) {
          setQrDataUrl(url);
          setSubmitHost(new URL(`${origin}/`).host);
        }
      } catch {
        // QRが作れなくてもショーには影響させない
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div ref={containerRef} className={styles.stage}>
      <div ref={canvasHostRef} className={styles.canvasHost} />
      <LanternRiver ref={lanternRef} enabled={messagesOn} />
      {qrVisible && <QrCorner dataUrl={qrDataUrl} host={submitHost} />}
      {!overlayGone && <StartOverlay fading={started} onStart={handleStart} />}
    </div>
  );
}
