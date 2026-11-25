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
import { readJsonObject, stringField, transactionHashField } from "@/lib/server/request";

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
        "Simulated fills never carry a transaction hash.",
        400,
        "simulated_venue",
        correlationId,
      );
    }
    if (!rateLimit(`submitted:${session.address}:${clientIp(req)}`, 12)) {
      return error(
        "Too many submission verification requests.",
        429,
        "rate_limited",
        correlationId,
      );
    }
    const body = await readJsonObject(req);
    const intentId = stringField(body, "intentId", { maximumLength: 128 });
    const txHash = transactionHashField(body);
    const { environment } = await import("@/lib/server/store-singleton");
    const { recordSubmitted } = await import("@/lib/server/activity");
    await recordSubmitted(environment(), intentId, txHash, session.address);
    return json({ ok: true });
  } catch (err) {
    return routeError(err, "submitted_unavailable", correlationId);
  }
}
