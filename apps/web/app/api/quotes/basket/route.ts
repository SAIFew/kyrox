import {
  MAX_BASKET_LEGS,
  TESTNET_TRADE_POLICY,
  evaluateBasketPolicy,
  validateBasket,
} from "@kyrox/core";

import { isDemoMode } from "@/lib/demo/mode";
import { DemoQuoteError, createDemoQuote } from "@/lib/demo/quote";
import { dailySpentUsdc, readDemoSession } from "@/lib/demo/session";
import { appDatabase } from "@/lib/server/database";
import { getSession } from "@/lib/server/session";
import { readPolicyForQuote } from "@/lib/server/policy-store";
import { PolicyRpcPolicy } from "@/lib/server/policy";
import { issueUserQuote } from "@/lib/server/quotes";
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

interface Leg {
  symbol: string;
  amountUsdc: string;
}

export async function POST(req: Request) {
  const correlationId = requestId();
  try {
    if (!evaluateSameOrigin(req).allowed) {
      return error("Cross-origin request rejected.", 403, "origin", correlationId);
    }
    const session = await getSession();
    if (session === null) return error("Authentication required.", 401, "auth", correlationId);
    if (!rateLimit(`basket-quote:${clientIp(req)}`, 12)) {
      return error("Too many basket quote requests.", 429, "rate_limited", correlationId);
    }
    const body = await readJsonObject(req);
    const raw = body["legs"];
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_BASKET_LEGS) {
      return error(`Provide between 1 and ${MAX_BASKET_LEGS} legs.`, 400, "legs", correlationId);
    }
    const legs: Leg[] = raw.map((entry) => {
      if (entry === null || typeof entry !== "object") throw new Error("Invalid basket leg.");
      const row = entry as Record<string, unknown>;
      if (typeof row["symbol"] !== "string" || typeof row["amountUsdc"] !== "string") {
        throw new Error("Each leg needs symbol and amountUsdc.");
      }
      if (!/^\d{1,78}$/.test(row["amountUsdc"])) throw new Error("amountUsdc must be base units.");
      return { symbol: row["symbol"], amountUsdc: row["amountUsdc"] };
    });

    if (isDemoMode()) {
      const demo = await readDemoSession();
      if (demo === null) return error("Session expired. Start again.", 401, "auth", correlationId);
      const summary = validateBasket(
        legs.map((leg) => ({ symbol: leg.symbol, amountInUsdc: BigInt(leg.amountUsdc) })),
        TESTNET_TRADE_POLICY.allowedAssets,
      );
      const violations = evaluateBasketPolicy(
        summary,
        TESTNET_TRADE_POLICY,
        dailySpentUsdc(demo),
        true,
      );
      if (violations.length > 0) {
        return error(
          violations[0]?.message ?? "Basket rejected by policy.",
          400,
          "policy",
          correlationId,
        );
      }
      const quotes = legs.map((leg) =>
        createDemoQuote({
          session: demo,
          symbol: leg.symbol,
          side: "buy",
          amountIn: BigInt(leg.amountUsdc),
          slippageBps: 50,
        }),
      );
      return json({
        mode: "demo",
        simulated: true,
        quotes,
        totalUsdc: summary.totalUsdc.toString(),
        disclaimer: "Test tokens. No real value. Not real shares. Not investment advice.",
        executionNote: "Preview execution applies all legs atomically to the local ledger.",
      });
    }

    const db = appDatabase().db;
    const effective = await readPolicyForQuote(db);
    const summary = validateBasket(
      legs.map((leg) => ({ symbol: leg.symbol, amountInUsdc: BigInt(leg.amountUsdc) })),
      effective.policy.allowedAssets,
    );
    const env = environment();
    const spent = await new PolicyRpcPolicy(env).dailySpentUsdc(session.address as `0x${string}`);
    const violations = evaluateBasketPolicy(
      summary,
      effective.policy,
      spent,
      effective.tradingEnabled,
    );
    if (violations.length > 0) {
      return error(
        violations[0]?.message ?? "Basket rejected by policy.",
        423,
        violations[0]?.code.toLowerCase() ?? "policy",
        correlationId,
      );
    }
    const quotes = [];
    for (const leg of legs) {
      quotes.push(
        await issueUserQuote(env, session, {
          symbol: leg.symbol,
          side: "buy",
          amountIn: leg.amountUsdc,
          slippageBps: 50,
        }),
      );
    }
    return json({
      mode: "live",
      simulated: false,
      quotes,
      totalUsdc: summary.totalUsdc.toString(),
      disclaimer: "Test tokens. No real value. Not real shares. Not investment advice.",
      executionNote:
        "Each leg is an independent signed intent. Without a smart-account batch, the wallet may ask for each signature separately.",
    });
  } catch (err) {
    if (err instanceof DemoQuoteError)
      return error(err.message, err.status, err.code, correlationId);
    if (err instanceof Error && /leg|basket|allowlist|amount/i.test(err.message)) {
      return error(err.message, 400, "basket", correlationId);
    }
    return routeError(err, "basket_quote_unavailable", correlationId);
  }
}
