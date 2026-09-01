import { NextResponse, type NextRequest } from "next/server";

/**
 * 公開運用時の管理保護。
 * 環境変数 ADMIN_KEY を設定すると、/admin と破壊系 API (非表示化・全削除・設定変更) が
 * キー無しではアクセスできなくなる。ADMIN_KEY 未設定なら従来通り素通し (会場ローカル運用)。
 *
 * 使い方: /admin?key=<ADMIN_KEY> を一度開くと Cookie が設定され、以後は /admin をそのまま使える。
 */

const COOKIE_NAME = "hanabi_admin";

/** キー必須の API (メソッド単位)。投稿(POST)や取得系は誰でも使える */
function isProtectedApi(pathname: string, method: string): boolean {
  if (method === "PATCH" && /^\/api\/fireworks\/[^/]+$/.test(pathname)) return true;
  if (method === "DELETE" && pathname === "/api/fireworks") return true;
  if (method === "PATCH" && pathname === "/api/settings") return true;
  return false;
}

export function middleware(req: NextRequest) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return NextResponse.next();

  const { pathname } = req.nextUrl;
  const cookieOk = req.cookies.get(COOKIE_NAME)?.value === adminKey;

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const queryKey = req.nextUrl.searchParams.get("key");
    if (queryKey === adminKey) {
      // キー付きで来たら Cookie を発行して key をURLから消す
      const url = req.nextUrl.clone();
      url.searchParams.delete("key");
      const res = NextResponse.redirect(url);
      res.cookies.set(COOKIE_NAME, adminKey, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24,
      });
      return res;
    }
    if (!cookieOk) {
      // 存在自体を隠す
      return new NextResponse("Not Found", { status: 404 });
    }
    return NextResponse.next();
  }

  if (isProtectedApi(pathname, req.method) && !cookieOk) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/:path*"],
};
