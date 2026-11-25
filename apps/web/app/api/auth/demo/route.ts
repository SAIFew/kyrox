import { isDemoMode } from "@/lib/demo/mode";
import {
  DEMO_SESSION_TTL_SECONDS,
  defaultDemoLedger,
  newDemoAddress,
  readDemoSession,
  writeDemoSession,
  type DemoSession,
} from "@/lib/demo/session";
import {
  clientIp,
  error,
  evaluateSameOrigin,
  json,
  rateLimit,
  requestId,
  routeError,
} from "@/lib/server/http";
import { readJsonObject } from "@/lib/server/request";

export async function POST(req: Request) {
  const correlationId = requestId();
  if (!isDemoMode()) {
    return error(
      "The preview account is only available in simulated mode.",
      404,
      "not_demo",
      correlationId,
    );
  }
  try {
    if (!evaluateSameOrigin(req).allowed) {
      return error("Cross-origin request rejected.", 403, "origin", correlationId);
    }
    if (!rateLimit(`demo-login:${clientIp(req)}`, 12)) {
      return error("Too many attempts. Try again shortly.", 429, "rate_limited");
    }
    const body = await readJsonObject(req, { allowEmpty: true });
    if ("reset" in body && typeof body["reset"] !== "boolean") {
      return error("reset must be a boolean when supplied.", 400, "fields", correlationId);
    }
    const reset = body["reset"] === true;

    const existing = await readDemoSession();
    const address = existing?.address ?? newDemoAddress();
    const session: DemoSession = {
      address,
      expiresAt: Math.floor(Date.now() / 1_000) + DEMO_SESSION_TTL_SECONDS,
      demo: true,
      ledger: reset || existing === null ? defaultDemoLedger() : existing.ledger,
    };
    await writeDemoSession(session);
    return json({
      authenticated: true,
      address: session.address,
      demo: true,
      simulated: true,
      expiresAt: session.expiresAt,
    });
  } catch (err) {
    return routeError(err, "demo_auth_unavailable", correlationId);
  }
}
