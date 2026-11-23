import {
  BASE_SEPOLIA_CHAIN_ID,
  TESTNET_ASSETS,
  TESTNET_TRADE_POLICY,
  assertPolicyAllows,
  createQuote,
  evaluateTradePolicy,
  fromBaseUnits,
  type AssetDefinition,
  type PriceBounds,
} from "@kyrox/core";

import type { QuotePayload, TradeSide } from "../market-types.js";
import { demoAsset, demoObservation, priceAt } from "./market.js";
import {
  applyFill,
  balanceOf,
  dailySpentUsdc,
  seal,
  unseal,
  type DemoFill,
  type DemoSession,
} from "./session.js";

const QUOTE_TTL_SECONDS = 120;
const PRICE_BOUNDS: PriceBounds = {
  minPriceUsdcPerWholeToken: 1_000_000n,
  maxPriceUsdcPerWholeToken: 1_000_000_000_000n,
};

interface StoredDemoQuote {
  v: 1;
  q: string;
  a: string;
  s: string;
  side: TradeSide;
  ai: string;
  ao: string;
  min: string;
  p: string;
  su: number;
  exp: number;
}

function displayAmount(value: bigint, decimals: number): string {
  const raw = fromBaseUnits(value, decimals);
  const [whole = "0", fraction = ""] = raw.split(".");
  const trimmed = fraction.slice(0, 6).replace(/0+$/, "");
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole;
}

export class DemoQuoteError extends Error {
  override readonly name = "DemoQuoteError";

  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function assetDefinition(symbol: string): AssetDefinition {
  const base = TESTNET_ASSETS.find((entry) => entry.symbol === symbol);
  const meta = demoAsset(symbol);
  if (base === undefined || meta === null) {
    throw new DemoQuoteError("unsupported_asset", `Unsupported asset: ${symbol}.`, 404);
  }
  return {
    ...base,
    name: meta.name,
    stockDecimals: meta.decimals === 6 || meta.decimals === 8 ? meta.decimals : 18,
  };
}

function quoteFor(
  session: DemoSession,
  symbol: string,
  side: TradeSide,
  amountIn: bigint,
  slippageBps: number,
  now: number,
) {
  const asset = assetDefinition(symbol);
  const quote = createQuote(
    { assetSymbol: symbol, side, amountIn, maxSlippageBps: slippageBps },
    asset,
    demoObservation(symbol, now),
    {
      nowSeconds: now,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      freshnessConfig: {
        assetSymbol: symbol,
        maxSourceAgeSeconds: 3_600,
        requireOpenMarket: false,
      },
      session: "open",
      priceBounds: PRICE_BOUNDS,
      quoteTtlSeconds: QUOTE_TTL_SECONDS,
    },
  );

  const decision = evaluateTradePolicy(quote, TESTNET_TRADE_POLICY, {
    nowSeconds: now,
    utcDay: Math.floor(now / 86_400),
    dailySpentUsdc: dailySpentUsdc(session, now * 1_000),
    exchangePaused: false,
    assetEnabled: true,
    session: "open",
    freshness: {
      assetSymbol: symbol,
      maxSourceAgeSeconds: 3_600,
      requireOpenMarket: false,
    },
    priceBounds: PRICE_BOUNDS,
  });
  assertPolicyAllows(decision);

  const symbolIn = side === "buy" ? "tUSDC" : symbol;
  if (balanceOf(session, symbolIn) < amountIn) {
    throw new DemoQuoteError(
      "insufficient_balance",
      side === "buy"
        ? "Not enough simulated tUSDC for this order."
        : `Not enough simulated ${symbol} for this order.`,
    );
  }

  return { quote, asset, decision };
}

export function createDemoQuote(input: {
  session: DemoSession;
  symbol: string;
  side: TradeSide;
  amountIn: bigint;
  slippageBps: number;
  now?: number;
}): QuotePayload {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const { quote, asset, decision } = quoteFor(
    input.session,
    input.symbol,
    input.side,
    input.amountIn,
    input.slippageBps,
    now,
  );
  if (!decision.allowed) {
    const first = decision.violations[0];
    throw new DemoQuoteError(
      first?.code.toLowerCase() ?? "policy",
      first?.message ?? "Trade policy rejected the order.",
    );
  }
  const quoteId = `${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const token = seal({
    v: 1,
    q: quoteId,
    a: input.session.address.toLowerCase(),
    s: input.symbol,
    side: input.side,
    ai: quote.amountIn.toString(),
    ao: quote.amountOut.toString(),
    min: quote.minAmountOut.toString(),
    p: quote.priceUsdcPerWholeToken.toString(),
    su: quote.sourceUpdatedAt,
    exp: quote.expiresAt,
  } satisfies StoredDemoQuote);
  const spent = dailySpentUsdc(input.session, now * 1_000);
  const remaining = TESTNET_TRADE_POLICY.dailyLimitUsdc - spent;
  const assetPrice = BigInt(quote.priceUsdcPerWholeToken);

  return {
    quoteId,
    quoteToken: token,
    symbol: input.symbol,
    side: input.side,
    priceUsdc: fromBaseUnits(assetPrice, 6),
    amountIn: quote.amountIn.toString(),
    amountOut: quote.amountOut.toString(),
    minAmountOut: quote.minAmountOut.toString(),
    amountInLabel: displayAmount(quote.amountIn, input.side === "buy" ? 6 : asset.stockDecimals),
    amountOutLabel: displayAmount(quote.amountOut, input.side === "buy" ? asset.stockDecimals : 6),
    minAmountOutLabel: displayAmount(
      quote.minAmountOut,
      input.side === "buy" ? asset.stockDecimals : 6,
    ),
    sourceUpdatedAt: quote.sourceUpdatedAt,
    expiresAt: quote.expiresAt,
    simulated: true,
    simulatedPrice: true,
    limits: {
      minUsdc: fromBaseUnits(TESTNET_TRADE_POLICY.minTradeUsdc, 6),
      maxUsdc: fromBaseUnits(TESTNET_TRADE_POLICY.maxTradeUsdc, 6),
      dailyUsdc: fromBaseUnits(TESTNET_TRADE_POLICY.dailyLimitUsdc, 6),
      remainingUsdc: fromBaseUnits(remaining > 0n ? remaining : 0n, 6),
    },
  };
}

export function executeDemoQuote(input: {
  session: DemoSession;
  quoteId: string;
  quoteToken: string;
  now?: number;
}): { session: DemoSession; fill: DemoFill } {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const stored = unseal<StoredDemoQuote>(input.quoteToken);
  if (stored === null || stored.v !== 1) {
    throw new DemoQuoteError("invalid_quote", "Quote token is invalid. Request a new quote.");
  }
  if (stored.q !== input.quoteId) {
    throw new DemoQuoteError("invalid_quote", "Quote id does not match the signed quote.");
  }
  if (stored.a !== input.session.address.toLowerCase()) {
    throw new DemoQuoteError("invalid_quote", "Quote belongs to a different account.", 403);
  }
  if (stored.exp <= now) {
    throw new DemoQuoteError("quote_expired", "Quote expired. Request a fresh quote.");
  }

  const expectedPrice = BigInt(stored.p);
  const currentPrice = priceAt(stored.s, now);
  const movePct = Number(currentPrice - expectedPrice) / Number(expectedPrice);
  if (Math.abs(movePct) > 0.01) {
    throw new DemoQuoteError(
      "price_moved",
      "The simulated reference price moved more than 1%. Request a new quote.",
    );
  }

  const amountIn = BigInt(stored.ai);
  const minOut = BigInt(stored.min);
  const { quote } = quoteFor(input.session, stored.s, stored.side, amountIn, 0, now);
  const currentOut = quote.amountOut;
  if (currentOut < minOut) {
    throw new DemoQuoteError(
      "slippage_exceeded",
      "Output fell below the minimum received. Request a new quote.",
    );
  }

  const { session, fill } = applyFill(input.session, {
    symbol: stored.s,
    side: stored.side,
    amountIn: stored.ai,
    amountOut: currentOut.toString(),
    priceUsdc: currentPrice.toString(),
  });
  return { session, fill };
}

export function demoNotional(side: TradeSide, amountIn: bigint, amountOut: bigint): bigint {
  return side === "buy" ? amountIn : amountOut;
}

export function demoDailyRemaining(
  session: DemoSession,
  now = Math.floor(Date.now() / 1000),
): bigint {
  const spent = dailySpentUsdc(session, now * 1_000);
  const remaining = TESTNET_TRADE_POLICY.dailyLimitUsdc - spent;
  return remaining > 0n ? remaining : 0n;
}

export function demoQuoteNotional(quote: QuotePayload): bigint {
  return quote.side === "buy" ? BigInt(quote.amountIn) : BigInt(quote.amountOut);
}
