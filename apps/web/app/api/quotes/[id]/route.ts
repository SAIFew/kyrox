import { fromBaseUnits, type Quote } from "@kyrox/core";

import { isDemoMode } from "@/lib/demo/mode";
import { environment, authStore } from "@/lib/server/store-singleton";
import {
  clientIp,
  error,
  json,
  rateLimit,
  routeError,
  sessionFromCookies,
} from "@/lib/server/http";
import { quoteSimulationFlags } from "@/lib/server/labels";
import { quoteById } from "@/lib/server/quotes";
import { stringField } from "@/lib/server/request";

export const dynamic = "force-dynamic";

interface StoredQuoteResponse {
  readonly quoteId: string;
  readonly assetSymbol: string;
  readonly stockToken: Quote["stockToken"];
  readonly chainId: number;
  readonly side: Quote["side"];
  readonly stockDecimals: number;
  readonly priceUsdcPerWholeToken: string;
  readonly priceUsdcPerWholeTokenUnits: string;
  readonly amountIn: string;
  readonly amountOut: string;
  readonly minAmountOut: string;
  readonly sourceRoundId: string;
  readonly sourceUpdatedAt: number;
  readonly expiresAt: number;
  readonly ttlSeconds: number;
  readonly sourceKind: Quote["sourceKind"];
  readonly freshness: Quote["freshness"];
  readonly simulated: boolean;
  readonly simulatedPrice: boolean;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (isDemoMode()) {
    return error(
      "Preview quotes are signed and short-lived; they are not persisted for lookup. Request a new quote.",
      404,
      "not_persisted",
    );
  }
  try {
    const session = await sessionFromCookies(authStore());
    if (session === null) return error("Authentication required.", 401, "auth");
    if (!rateLimit(`quote-read:${session.address}:${clientIp(req)}`, 60)) {
      return error("Too many quote lookups.", 429, "rate_limited");
    }
    const { id } = await params;
    const quoteId = stringField({ id }, "id", { maximumLength: 128 });
    const env = environment();
    const record = await quoteById(env, quoteId);
    if (record === null) return error("Quote not found.", 404, "not_found");
    if (record.trader.toLowerCase() !== session.address.toLowerCase()) {
      return error("Quote belongs to another wallet.", 403, "forbidden");
    }

    // Never spread a persisted record: its quote and observation contain bigints.
    const payload: StoredQuoteResponse = {
      quoteId: record.id,
      assetSymbol: record.quote.assetSymbol,
      stockToken: record.quote.stockToken,
      chainId: record.quote.chainId,
      side: record.quote.side,
      stockDecimals: record.quote.stockDecimals,
      priceUsdcPerWholeToken: fromBaseUnits(record.quote.priceUsdcPerWholeToken, 6),
      priceUsdcPerWholeTokenUnits: record.quote.priceUsdcPerWholeToken.toString(),
      amountIn: record.quote.amountIn.toString(),
      amountOut: record.quote.amountOut.toString(),
      minAmountOut: record.quote.minAmountOut.toString(),
      sourceRoundId: record.quote.sourceRoundId.toString(),
      sourceUpdatedAt: record.quote.sourceUpdatedAt,
      expiresAt: record.quote.expiresAt,
      ttlSeconds: record.expiresAt - record.issuedAt,
      sourceKind: record.quote.sourceKind,
      freshness: {
        fresh: record.quote.freshness.fresh,
        ageSeconds: record.quote.freshness.ageSeconds,
        session: record.quote.freshness.session,
        sourceKind: record.quote.freshness.sourceKind,
        reason: record.quote.freshness.reason,
      },
      ...quoteSimulationFlags(env.mode, record.observation),
    };
    return json(payload);
  } catch (err) {
    return routeError(err, "quote_unavailable");
  }
}
