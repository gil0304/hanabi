import { NextResponse } from "next/server";
import { fetchNextFireworks } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** スクリーン用: 次に打ち上げる花火を優先順位付きで取得 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    count?: unknown;
  } | null;

  const raw = typeof body?.count === "number" ? body.count : 1;
  const count = Number.isFinite(raw) ? Math.min(10, Math.max(1, Math.floor(raw))) : 1;

  const records = await fetchNextFireworks(count);
  return NextResponse.json(records);
}
