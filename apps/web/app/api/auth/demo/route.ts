import { isDemoMode } from "@/lib/demo/mode";
import {
  DEMO_SESSION_TTL_SECONDS,
  defaultDemoLedger,
  newDemoAddress,
  readDemoSession,
  writeDemoSession,
  type DemoSession,
} from "@/lib/demo/session";
import { clientIp, error, json, rateLimit, sameOrigin } from "@/lib/server/http";

export async function POST(req: Request) {
  if (!isDemoMode()) {
    return error("The preview account is only available in simulated mode.", 404, "not_demo");
  }
  if (!sameOrigin(req)) return error("Cross-origin request rejected.", 403, "origin");
  if (!rateLimit(`demo-login:${clientIp(req)}`, 12))
    return error("Too many attempts. Try again shortly.", 429, "rate_limited");

  const body = (await req.json().catch(() => ({}))) as { reset?: boolean };
  const reset = body.reset === true;

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
}
