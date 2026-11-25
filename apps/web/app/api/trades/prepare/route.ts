import { isDemoMode } from "@/lib/demo/mode";
import { getSession } from "@/lib/server/session";
import {
  clientIp,
  error,
  evaluateSameOrigin,
  json,
  rateLimit,
  requestId,
  routeError,
} from "@/lib/server/http";
import { readJsonObject, stringField } from "@/lib/server/request";
import { recordProductEvent } from "@/lib/server/analytics";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const correlationId = requestId();
  try {
    if (!evaluateSameOrigin(req).allowed) {
      return error("Cross-origin request rejected.", 403, "origin", correlationId);
    }
    const session = await getSession();
    if (session === null) return error("Authentication required.", 401, "auth", correlationId);
    if (isDemoMode()) {
      return error(
        "The simulated venue executes directly. No wallet transaction is prepared.",
        400,
        "simulated_venue",
        correlationId,
      );
    }
    if (!rateLimit(`prepare:${session.address}:${clientIp(req)}`, 12)) {
      return error("Too many preparation requests.", 429, "rate_limited", correlationId);
    }
    const body = await readJsonObject(req);
    const quoteId = stringField(body, "quoteId", { maximumLength: 128 });
    const quoteToken = stringField(body, "quoteToken", { maximumLength: 256 });
    const { environment } = await import("@/lib/server/store-singleton");
    const { prepareUserIntent } = await import("@/lib/server/quotes");
    const prepared = await prepareUserIntent(environment(), session, quoteId, quoteToken);
    await recordProductEvent(session.address, "trade_approved", { quoteId });
    return json({ ...prepared, mode: "wallet" });
  } catch (err) {
    return routeError(err, "prepare_unavailable", correlationId);
  }
}
