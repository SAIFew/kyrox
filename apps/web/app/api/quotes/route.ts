import { isDemoMode } from "@/lib/demo/mode";
import { DemoQuoteError, createDemoQuote } from "@/lib/demo/quote";
import { readDemoSession } from "@/lib/demo/session";
import { getSession } from "@/lib/server/session";
import { clientIp, error, json, rateLimit, sameOrigin } from "@/lib/server/http";

export const dynamic = "force-dynamic";

interface QuoteBody {
  symbol?: string;
  side?: "buy" | "sell";
  amountIn?: string;
  slippageBps?: number;
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return error("Cross-origin request rejected.", 403, "origin");
  const session = await getSession();
  if (session === null) return error("Authentication required.", 401, "auth");

  if (isDemoMode()) {
    if (!rateLimit(`quote:${clientIp(req)}`, 30))
      return error("Too many quote requests.", 429, "rate_limited");
    let body: QuoteBody;
    try {
      body = (await req.json()) as QuoteBody;
    } catch {
      return error("Malformed JSON body.", 400, "bad_json");
    }
    if (body.symbol === undefined || body.side === undefined || body.amountIn === undefined) {
      return error("symbol, side and amountIn are required.", 400, "fields");
    }
    if (body.side !== "buy" && body.side !== "sell") return error("Invalid side.", 400, "side");
    if (!/^\d+$/.test(body.amountIn) || BigInt(body.amountIn) <= 0n) {
      return error("amountIn must be a positive integer in base units.", 400, "amount");
    }
    const slippageBps = body.slippageBps ?? 50;
    if (!isSlippage(slippageBps)) {
      return error("slippageBps must be an integer 0..1000.", 400, "slippage");
    }
    const demo = await readDemoSession();
    if (demo === null) return error("Session expired. Start again.", 401, "auth");
    try {
      return json({
        quote: createDemoQuote({
          session: demo,
          symbol: body.symbol,
          side: body.side,
          amountIn: BigInt(body.amountIn),
          slippageBps,
        }),
      });
    } catch (err) {
      if (err instanceof DemoQuoteError) return error(err.message, err.status, err.code);
      return error(err instanceof Error ? err.message : "Quote failed.", 400, "quote");
    }
  }

  const { environment } = await import("@/lib/server/store-singleton");
  const { mapQuoteError } = await import("@/lib/server/quote-errors");
  const { issueUserQuote } = await import("@/lib/server/quotes");
  if (!rateLimit(`quote:${clientIp(req)}`, 20))
    return error("Too many quote requests.", 429, "rate_limited");
  try {
    const body = (await req.json()) as QuoteBody;
    if (body.symbol === undefined || body.side === undefined || body.amountIn === undefined) {
      return error("symbol, side and amountIn are required.", 400, "fields");
    }
    if (body.side !== "buy" && body.side !== "sell") return error("Invalid side.", 400, "side");
    if (!/^\d+$/.test(body.amountIn) || BigInt(body.amountIn) <= 0n) {
      return error("amountIn must be a positive integer in base units.", 400, "amount");
    }
    const slippageBps = body.slippageBps ?? 50;
    if (!isSlippage(slippageBps)) {
      return error("slippageBps must be an integer 0..1000.", 400, "slippage");
    }
    return json({
      quote: await issueUserQuote(environment(), session, {
        symbol: body.symbol,
        side: body.side,
        amountIn: body.amountIn,
        slippageBps,
      }),
    });
  } catch (err) {
    const mapped = mapQuoteError(err);
    return error(mapped.message, mapped.status, mapped.code);
  }
}

function isSlippage(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 1_000;
}
