import { environment } from "@/lib/server/store-singleton";
import { authStore } from "@/lib/server/store-singleton";
import {
  clientIp,
  error,
  json,
  rateLimit,
  sameOrigin,
  sessionFromCookies,
} from "@/lib/server/http";
import { prepareUserIntent } from "@/lib/server/quotes";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return error("Cross-origin request rejected.", 403, "origin");
  const session = await sessionFromCookies(authStore());
  if (session === null) return error("Authentication required.", 401, "auth");
  if (!rateLimit(`prepare:${clientIp(req)}`, 12))
    return error("Too many preparation requests.", 429, "rate_limited");
  const body = (await req.json()) as { quoteId?: string; quoteToken?: string };
  if (typeof body.quoteId !== "string" || typeof body.quoteToken !== "string") {
    return error("quoteId and quoteToken are required.", 400, "fields");
  }
  try {
    return json(await prepareUserIntent(environment(), session, body.quoteId, body.quoteToken));
  } catch (err) {
    return error(err instanceof Error ? err.message : "Preparation failed.", 400, "prepare");
  }
}
