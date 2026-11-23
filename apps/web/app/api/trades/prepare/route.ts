import { isDemoMode } from "@/lib/demo/mode";
import { getSession } from "@/lib/server/session";
import { clientIp, error, json, rateLimit, sameOrigin } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return error("Cross-origin request rejected.", 403, "origin");
  const session = await getSession();
  if (session === null) return error("Authentication required.", 401, "auth");
  if (isDemoMode()) {
    return error(
      "The simulated venue executes directly. No wallet transaction is prepared.",
      400,
      "simulated_venue",
    );
  }
  if (!rateLimit(`prepare:${clientIp(req)}`, 12))
    return error("Too many preparation requests.", 429, "rate_limited");
  const body = (await req.json()) as { quoteId?: string; quoteToken?: string };
  if (typeof body.quoteId !== "string" || typeof body.quoteToken !== "string") {
    return error("quoteId and quoteToken are required.", 400, "fields");
  }
  const { environment } = await import("@/lib/server/store-singleton");
  const { prepareUserIntent } = await import("@/lib/server/quotes");
  try {
    return json(await prepareUserIntent(environment(), session, body.quoteId, body.quoteToken));
  } catch (err) {
    return error(err instanceof Error ? err.message : "Preparation failed.", 400, "prepare");
  }
}
