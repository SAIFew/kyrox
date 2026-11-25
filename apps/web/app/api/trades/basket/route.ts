import { MAX_BASKET_LEGS } from "@kyrox/core";

import { isDemoMode } from "@/lib/demo/mode";
import { DemoQuoteError, executeDemoQuote } from "@/lib/demo/quote";
import { demoActivity, demoPortfolio, readDemoSession, writeDemoSession } from "@/lib/demo/session";
import { getSession } from "@/lib/server/session";
import { prepareUserIntent } from "@/lib/server/quotes";
import { environment } from "@/lib/server/store-singleton";
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

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const correlationId = requestId();
  try {
    if (!evaluateSameOrigin(req).allowed) {
      return error("Cross-origin request rejected.", 403, "origin", correlationId);
    }
    const session = await getSession();
    if (session === null) return error("Authentication required.", 401, "auth", correlationId);
    if (!rateLimit(`basket-execute:${clientIp(req)}`, 8)) {
      return error("Too many basket requests.", 429, "rate_limited", correlationId);
    }
    const body = await readJsonObject(req);
    const raw = body["quotes"];
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_BASKET_LEGS) {
      return error(
        `Provide between 1 and ${MAX_BASKET_LEGS} quotes.`,
        400,
        "quotes",
        correlationId,
      );
    }
    const quotes = raw.map((entry) => {
      if (entry === null || typeof entry !== "object") throw new Error("Invalid quote reference.");
      const row = entry as Record<string, unknown>;
      if (typeof row["quoteId"] !== "string" || typeof row["quoteToken"] !== "string") {
        throw new Error("Each reference needs quoteId and quoteToken.");
      }
      return { quoteId: row["quoteId"], quoteToken: row["quoteToken"] };
    });

    if (isDemoMode()) {
      const demo = await readDemoSession();
      if (demo === null) return error("Session expired. Start again.", 401, "auth", correlationId);
      try {
        let current = demo;
        const fills = [];
        for (const quote of quotes) {
          const result = executeDemoQuote({ session: current, ...quote });
          current = result.session;
          fills.push(result.fill);
        }
        await writeDemoSession(current);
        return json({
          mode: "demo",
          simulated: true,
          fills,
          portfolio: demoPortfolio(current),
          activity: demoActivity(current),
          message:
            "All simulated legs were applied to the local ledger. No transaction was created.",
        });
      } catch (err) {
        if (err instanceof DemoQuoteError)
          return error(err.message, err.status, err.code, correlationId);
        throw err;
      }
    }

    const prepared = [];
    for (const quote of quotes) {
      prepared.push(
        await prepareUserIntent(environment(), session, quote.quoteId, quote.quoteToken),
      );
    }
    return json({
      mode: "live",
      simulated: false,
      prepared,
      message:
        "Prepared unsigned intents. The wallet must sign each call; this endpoint never signs or broadcasts.",
    });
  } catch (err) {
    return routeError(err, "basket_execute_unavailable", correlationId);
  }
}
