import { NextResponse } from "next/server";
import { setFireworkStatus } from "@/lib/server/db";
import type { FireworkStatus } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isStatus(v: unknown): v is FireworkStatus {
  return v === "pending" || v === "approved" || v === "hidden";
}

/** ステータス変更 (管理画面用) */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as {
    status?: unknown;
  } | null;

  if (!body || !isStatus(body.status)) {
    return NextResponse.json(
      { ok: false, error: "invalid_status" },
      { status: 400 },
    );
  }

  const updated = await setFireworkStatus(id, body.status);
  if (!updated) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
