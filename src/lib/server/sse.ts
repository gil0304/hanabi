/**
 * SSE ブロードキャストハブ。
 * 接続中の ReadableStream コントローラを集合で持ち、全員に配信する。
 * dev ホットリロードや複数 Route モジュール間で共有するため globalThis 単一インスタンス。
 */

const HEARTBEAT_MS = 25_000;

interface SseClient {
  controller: ReadableStreamDefaultController<Uint8Array>;
}

interface HubState {
  clients: Set<SseClient>;
  heartbeat: ReturnType<typeof setInterval> | null;
}

const g = globalThis as typeof globalThis & { __hanabiSse?: HubState };

const encoder = new TextEncoder();

function getState(): HubState {
  if (!g.__hanabiSse) {
    g.__hanabiSse = { clients: new Set(), heartbeat: null };
  }
  return g.__hanabiSse;
}

function sendRaw(chunk: string): void {
  const state = getState();
  const bytes = encoder.encode(chunk);
  for (const client of state.clients) {
    try {
      client.controller.enqueue(bytes);
    } catch {
      // 閉じたコントローラは除去
      state.clients.delete(client);
    }
  }
  stopHeartbeatIfIdle(state);
}

function stopHeartbeatIfIdle(state: HubState): void {
  if (state.clients.size === 0 && state.heartbeat) {
    clearInterval(state.heartbeat);
    state.heartbeat = null;
  }
}

function addClient(controller: ReadableStreamDefaultController<Uint8Array>): SseClient {
  const state = getState();
  const client: SseClient = { controller };
  state.clients.add(client);
  if (!state.heartbeat) {
    // プロキシ等に接続を切られないためのハートビートコメント
    state.heartbeat = setInterval(() => sendRaw(":hb\n\n"), HEARTBEAT_MS);
  }
  return client;
}

function removeClient(client: SseClient): void {
  const state = getState();
  state.clients.delete(client);
  stopHeartbeatIfIdle(state);
}

/** 全クライアントへ SSE イベントを配信する */
export function broadcast(event: string, data: unknown): void {
  sendRaw(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * /api/stream 用のストリームを作る。
 * abort / cancel でクライアントをハブから外す。
 */
export function createSseStream(signal: AbortSignal): ReadableStream<Uint8Array> {
  let client: SseClient | null = null;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      client = addClient(controller);
      controller.enqueue(encoder.encode(": connected\n\n"));
      // 一部のプロキシ (cloudflared 経由等) は数KB溜まるまで本文を流さないため、
      // 接続直後にコメントで 4KB 分パディングしてバッファを押し流す
      controller.enqueue(encoder.encode(`: ${"p".repeat(4096)}\n\n`));
      signal.addEventListener("abort", () => {
        if (client) {
          removeClient(client);
          client = null;
        }
        try {
          controller.close();
        } catch {
          // 既に閉じていれば無視
        }
      });
    },
    cancel() {
      if (client) {
        removeClient(client);
        client = null;
      }
    },
  });
}
