import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/server/db";
import { broadcast } from "@/lib/server/sse";
import { sanitizeSettingsPatch } from "@/lib/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json(settings);
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => null)) as unknown;
  const patch = sanitizeSettingsPatch(body);
  const settings = await updateSettings(patch);
  broadcast("settings", settings);
  return NextResponse.json(settings);
}
