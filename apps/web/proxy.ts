import { NextResponse, type NextRequest } from "next/server";

const REFERRAL_COOKIE = "kyrox_ref";
const REFERRAL_TTL_SECONDS = 30 * 24 * 3_600;
const REFERRAL_CODE = /^KX[0-9A-F]{6}$/;

/**
 * Capture `?ref=KXxxxxxx` for later attribution during sign-in. The cookie is
 * HTTP-only and first-party; it never grants access or points by itself.
 */
export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const raw = request.nextUrl.searchParams.get("ref");
  if (raw === null) return response;
  const code = raw.trim().toUpperCase();
  if (!REFERRAL_CODE.test(code)) return response;
  response.cookies.set({
    name: REFERRAL_COOKIE,
    value: code,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: REFERRAL_TTL_SECONDS,
  });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml).*)"],
};
