import type {
  AssetDefinition,
  AssetFreshnessConfig,
  CreateQuoteOptions,
  PolicyContext,
  PriceBounds,
  PriceObservation,
  Quote,
  QuoteRequest,
} from "../src/index.js";
import { createQuote, SECONDS_PER_UTC_DAY } from "../src/index.js";

export const NOW = 1_700_000_000;
/** 230.000000 USDC per whole token. */
export const PRICE = 230_000_000n;
/** 1 tUSDC in 6-decimal units. */
export const USDC = 1_000_000n;

export const asset: AssetDefinition = {
  symbol: "tAAPL",
  name: "Test Apple",
  stockToken: null,
  stockDecimals: 18,
  priceSourceKind: "simulated",
  listed: true,
};

export function assetFor(stockDecimals: number, overrides: Partial<AssetDefinition> = {}) {
  return {
    ...asset,
    stockDecimals: stockDecimals as AssetDefinition["stockDecimals"],
    ...overrides,
  } satisfies AssetDefinition;
}

export const priceBounds: PriceBounds = {
  minPriceUsdcPerWholeToken: 1n,
  maxPriceUsdcPerWholeToken: 10n ** 12n,
};

export const freshnessConfig: AssetFreshnessConfig = {
  assetSymbol: "tAAPL",
  maxSourceAgeSeconds: 60,
  requireOpenMarket: true,
};

export function observation(overrides: Partial<PriceObservation> = {}): PriceObservation {
  return {
    assetSymbol: "tAAPL",
    priceUsdcPerWholeToken: PRICE,
    sourceRoundId: 11n,
    sourceUpdatedAt: NOW - 5,
    observedAt: NOW - 2,
    sourceChainId: 84532,
    feedAddress: null,
    sourceKind: "simulated",
    ...overrides,
  };
}

export function quoteOptions(overrides: Partial<CreateQuoteOptions> = {}): CreateQuoteOptions {
  return {
    nowSeconds: NOW,
    chainId: 84532,
    freshnessConfig,
    session: "open",
    priceBounds,
    ...overrides,
  };
}

export function buildQuote(
  request: Partial<QuoteRequest> = {},
  options: Partial<CreateQuoteOptions> = {},
  obs: PriceObservation = observation(),
): Quote {
  return createQuote(
    { assetSymbol: "tAAPL", side: "buy", amountIn: USDC, maxSlippageBps: 0, ...request },
    asset,
    obs,
    quoteOptions(options),
  );
}

export function policyContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    nowSeconds: NOW,
    utcDay: Math.floor(NOW / SECONDS_PER_UTC_DAY),
    dailySpentUsdc: 0n,
    exchangePaused: false,
    assetEnabled: true,
    session: "open",
    freshness: freshnessConfig,
    priceBounds,
    ...overrides,
  };
}
