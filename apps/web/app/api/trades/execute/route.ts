import { isDemoMode } from "@/lib/demo/mode";
import { DemoQuoteError, executeDemoQuote } from "@/lib/demo/quote";
import { demoActivity, demoPortfolio, readDemoSession, writeDemoSession } from "@/lib/demo/session";
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

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const correlationId = requestId();
  try {
    if (!evaluateSameOrigin(req).allowed) {
      return error("Cross-origin request rejected.", 403, "origin", correlationId);
    }
    const session = await getSession();
    if (session === null) return error("Authentication required.", 401, "auth", correlationId);
    if (!isDemoMode()) {
      return error(
        "On-chain execution is authorised in your wallet, not by this endpoint.",
        400,
        "wallet_required",
        correlationId,
      );
    }
    if (!rateLimit(`execute:${clientIp(req)}`, 20)) {
      return error("Too many simulated executions.", 429, "rate_limited", correlationId);
    }

    const body = await readJsonObject(req);
    const quoteId = stringField(body, "quoteId", { maximumLength: 128 });
    const quoteToken = stringField(body, "quoteToken", { maximumLength: 2_048 });
    const demo = await readDemoSession();
    if (demo === null) {
      return error("Session expired. Start again.", 401, "auth", correlationId);
    }
    try {
      const result = executeDemoQuote({ session: demo, quoteId, quoteToken });
      await writeDemoSession(result.session);
      const activity = demoActivity(result.session);
      const first = activity[0];
      return json({
        fill: first === undefined ? null : { ...first, reference: result.fill.reference },
        portfolio: demoPortfolio(result.session),
        activity,
        simulated: true,
        message: "Simulated fill recorded. No blockchain transaction was created.",
      });
    } catch (err) {
      if (err instanceof DemoQuoteError) {
        return error(err.message, err.status, err.code, correlationId);
      }
      throw err;
    }
  } catch (err) {
    return routeError(err, "execute_unavailable", correlationId);
  }
}
