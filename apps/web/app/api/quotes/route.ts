import { environment } from "@/lib/server/store-singleton";
import { authStore } from "@/lib/server/store-singleton";
import {
  error,
  json,
  sessionFromCookies,
  clientIp,
  rateLimit,
  sameOrigin,
} from "@/lib/server/http";
import { mapQuoteError } from "@/lib/server/quote-errors";
import { issueUserQuote } from "@/lib/server/quotes";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return error("Cross-origin request rejected.", 403, "origin");
  try {
    const session = await sessionFromCookies(authStore());
    if (session === null) return error("Authentication required.", 401, "auth");
    if (!rateLimit(`quote:${clientIp(req)}`, 20))
      return error("Too many quote requests.", 429, "rate_limited");
    const body = (await req.json()) as {
      symbol?: string;
      side?: "buy" | "sell";
      amountIn?: string;
      slippageBps?: number;
    };
    if (body.symbol === undefined || body.side === undefined || body.amountIn === undefined) {
      return error("symbol, side and amountIn are required.", 400, "fields");
    }
    if (body.side !== "buy" && body.side !== "sell") return error("Invalid side.", 400, "side");
    if (!/^\d+$/.test(body.amountIn) || BigInt(body.amountIn) <= 0n) {
      return error("amountIn must be a positive integer in base units.", 400, "amount");
    }
    const slippageBps = body.slippageBps ?? 50;
    if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 1000) {
      return error("slippageBps must be an integer 0..1000.", 400, "slippage");
    }
    return json(
      await issueUserQuote(environment(), session, {
        symbol: body.symbol,
        side: body.side,
        amountIn: body.amountIn,
        slippageBps,
      }),
    );
  } catch (err) {
    const mapped = mapQuoteError(err);
    return error(mapped.message, mapped.status, mapped.code);
  }
}
