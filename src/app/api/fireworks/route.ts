import { NextResponse } from "next/server";
import {
  createFirework,
  deleteAllFireworks,
  listFireworks,
} from "@/lib/server/db";
import { allowPost, getClientIp } from "@/lib/server/rateLimit";
import { broadcast } from "@/lib/server/sse";
import { sanitizeDrawing, sanitizeMessage } from "@/lib/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 正常な描画データは最大でも数百KB。パース前に弾く上限 */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** 投稿 */
export async function POST(req: Request) {
  // レート制限とサイズ上限はパースより先に (パースコスト自体を浴びないため)
  if (!allowPost(getClientIp(req))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "too_large" }, { status: 413 });
  }

  const body = (await req.json().catch(() => null)) as {
    drawing_data?: unknown;
    message?: unknown;
  } | null;

  if (!body) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const drawing = sanitizeDrawing(body.drawing_data);
  if (!drawing) {
    return NextResponse.json(
      { ok: false, error: "invalid_drawing" },
      { status: 400 },
    );
  }

  const message = sanitizeMessage(body.message);
  if (message === null) {
    return NextResponse.json(
      { ok: false, error: "invalid_message" },
      { status: 400 },
    );
  }

  const record = await createFirework(drawing, message);
  broadcast("firework", record);
  return NextResponse.json({ ok: true, id: record.id });
}

/** 全件取得 (管理画面用, 新しい順)。?scope=all */
export async function GET() {
  const records = await listFireworks();
  return NextResponse.json(records);
}

/** 全削除 (管理画面用) */
export async function DELETE() {
  await deleteAllFireworks();
  return NextResponse.json({ ok: true });
}
