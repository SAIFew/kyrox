import { cookies } from "next/headers";

import { requireSession, type AuthStore } from "./auth.js";

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit = 10, windowMs = 60_000): boolean {
  const now = Date.now();
  const current = buckets.get(key);
  if (current === undefined || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin === null || origin.length === 0) return true;
  const host = req.headers.get("host");
  if (host === null) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function error(message: string, status = 400, code = "bad_request"): Response {
  return Response.json({ error: message, code }, { status });
}

export async function sessionFromCookies(store: AuthStore) {
  const storeCookies = await cookies();
  return requireSession(store, storeCookies.get("kyrox_session")?.value);
}

export function requireWallet(
  session: Awaited<ReturnType<typeof requireSession>>,
): asserts session is NonNullable<typeof session> {
  if (session === null) {
    throw new Error("UNAUTHENTICATED");
  }
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}
