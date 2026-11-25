import type { QuotePayload } from "@/lib/market-types";
import { isDemoMode } from "@/lib/demo/mode";
import { DemoQuoteError, createDemoQuote } from "@/lib/demo/quote";
import { readDemoSession } from "@/lib/demo/session";
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
import { quoteRequestInput, readJsonObject } from "@/lib/server/request";
import { recordProductEvent } from "@/lib/server/analytics";
import { QuoteServiceError } from "@kyrox/trade-intent";

export const dynamic = "force-dynamic";

function withCompleteTtl(quote: QuotePayload, now: number): QuotePayload {
  return {
    ...quote,
    ttlSeconds: quote.ttlSeconds ?? Math.max(1, quote.expiresAt - now),
  };
}

export async function POST(req: Request) {
  const correlationId = requestId();
  try {
    if (!evaluateSameOrigin(req).allowed) {
      return error("Cross-origin request rejected.", 403, "origin", correlationId);
    }
    const session = await getSession();
    if (session === null) return error("Authentication required.", 401, "auth", correlationId);
    const demoMode = isDemoMode();
    if (!rateLimit(`quote:${clientIp(req)}`, demoMode ? 30 : 20)) {
      return error("Too many quote requests.", 429, "rate_limited", correlationId);
    }

    const input = quoteRequestInput(await readJsonObject(req));
    if (demoMode) {
      const demo = await readDemoSession();
      if (demo === null) {
        return error("Session expired. Start again.", 401, "auth", correlationId);
      }
      try {
        const quote = withCompleteTtl(
          createDemoQuote({
            session: demo,
            symbol: input.symbol,
            side: input.side,
            amountIn: BigInt(input.amountIn),
            slippageBps: input.slippageBps,
          }),
          Math.floor(Date.now() / 1_000),
        );
        // Preserve the original flat response while also exposing the canonical envelope.
        return json({ ...quote, quote });
      } catch (err) {
        if (err instanceof DemoQuoteError) {
          return error(err.message, err.status, err.code, correlationId);
        }
        throw err;
      }
    }

    const { environment } = await import("@/lib/server/store-singleton");
    const { issueUserQuote } = await import("@/lib/server/quotes");
    let quote: QuotePayload;
    try {
      quote = await issueUserQuote(environment(), session, input);
    } catch (err) {
      if (err instanceof QuoteServiceError) {
        await recordProductEvent(session.address, "quote_refused", { code: err.code });
      }
      throw err;
    }
    await recordProductEvent(session.address, "quote_shown", {
      symbol: input.symbol,
      side: input.side,
    });
    return json({ ...quote, quote });
  } catch (err) {
    return routeError(err, "quote_unavailable", correlationId);
  }
}
