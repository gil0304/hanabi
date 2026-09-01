import { createSseStream } from "@/lib/server/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE ストリーム。イベント:
 *  - "firework": 新規投稿 (FireworkRecord JSON)
 *  - "settings": 設定変更 (ScreenSettings JSON)
 * 25秒ごとにハートビートコメントを送る。
 */
export async function GET(req: Request) {
  const stream = createSseStream(req.signal);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx 等のバッファリングを無効化
      "X-Accel-Buffering": "no",
    },
  });
}
