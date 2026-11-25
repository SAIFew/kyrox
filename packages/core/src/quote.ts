import { assertAssetDefinition, isSupportedStockDecimals, type AssetDefinition } from "./assets.js";
import { CoreError } from "./errors.js";
import {
  assessFreshness,
  assertPriceObservation,
  assertPriceWithinBounds,
  type AssetFreshnessConfig,
  type FreshnessAssessment,
  type MarketSession,
  type PriceBounds,
  type PriceObservation,
} from "./price.js";

/** Fixed-reference-price mint/burn model. No AMM, no routing, no fee. */
export type TradeSide = "buy" | "sell";

/** The protocol rounds every output down, so the venue never over-pays a user. */
export const ROUNDING_DIRECTION = "down" as const;

/**
 * Quotes are short-lived by design. Thirty seconds keeps the reference price
 * close to execution time and matches the testnet MVP validity window.
 */
export const DEFAULT_QUOTE_TTL_SECONDS = 30;
export const MAX_SLIPPAGE_BPS = 1_000;
export const MAX_UINT256 = 2n ** 256n - 1n;

export interface QuoteRequest {
  readonly assetSymbol: string;
  readonly side: TradeSide;
  readonly amountIn: bigint;
  /**
   * Maximum acceptable shortfall versus the quoted output.
   * Applied identically in the TS engine and the Solidity exchange.
   */
  readonly maxSlippageBps: number;
}

export interface Quote {
  readonly assetSymbol: string;
  readonly stockToken: `0x${string}` | null;
  readonly chainId: number;
  readonly side: TradeSide;
  readonly stockDecimals: number;
  readonly priceUsdcPerWholeToken: bigint;
  /** 6-decimal USDC for a buy, stock base units for a sell. */
  readonly amountIn: bigint;
  /** Stock base units for a buy, 6-decimal USDC for a sell. */
  readonly amountOut: bigint;
  readonly minAmountOut: bigint;
  readonly sourceRoundId: bigint;
  readonly sourceUpdatedAt: number;
  readonly expiresAt: number;
  readonly sourceKind: PriceObservation["sourceKind"];
  readonly sourceChainId: number;
  readonly feedAddress: PriceObservation["feedAddress"];
  readonly freshness: FreshnessAssessment;
}

export function assertTradeSide(value: unknown): asserts value is TradeSide {
  if (value !== "buy" && value !== "sell") {
    throw new CoreError("INVALID_SIDE", `Trade side must be buy or sell, got ${String(value)}.`);
  }
}

function assertStockDecimals(value: number): asserts value is AssetDefinition["stockDecimals"] {
  if (!isSupportedStockDecimals(value)) {
    throw new CoreError(
      "INVALID_DECIMALS",
      `Stock decimals must be one of 6, 8 or 18, got ${String(value)}.`,
    );
  }
}

export function assertPositiveAmount(value: bigint, label: string): bigint {
  if (typeof value !== "bigint") {
    throw new CoreError("INVALID_AMOUNT", `${label} must be a bigint, got ${typeof value}.`);
  }
  if (value <= 0n) {
    throw new CoreError("INVALID_AMOUNT", `${label} must be greater than zero.`);
  }
  if (value > MAX_UINT256) {
    throw new CoreError("INVALID_AMOUNT", `${label} exceeds the uint256 range.`);
  }
  return value;
}

function assertPositivePrice(price: bigint): bigint {
  if (typeof price !== "bigint") {
    throw new CoreError("INVALID_PRICE", `Price must be a bigint, got ${typeof price}.`);
  }
  if (price <= 0n) {
    throw new CoreError("INVALID_PRICE", "Price must be greater than zero.");
  }
  return price;
}

function assertSlippageBps(maxSlippageBps: number): number {
  if (
    !Number.isInteger(maxSlippageBps) ||
    maxSlippageBps < 0 ||
    maxSlippageBps > MAX_SLIPPAGE_BPS
  ) {
    throw new CoreError(
      "INVALID_SLIPPAGE",
      `maxSlippageBps must be an integer between 0 and ${MAX_SLIPPAGE_BPS}, got ${String(maxSlippageBps)}.`,
    );
  }
  return maxSlippageBps;
}

function assertUint256(value: bigint, label: string): bigint {
  if (value > MAX_UINT256) {
    throw new CoreError("INVALID_AMOUNT", `${label} exceeds the uint256 range.`);
  }
  return value;
}

/**
 * Stock received for a given USDC input.
 *
 *   stockOut = floor(usdcIn * 10^stockDecimals / price6)
 */
export function calculateBuyStockOut(
  usdcIn: bigint,
  priceUsdcPerWholeToken: bigint,
  stockDecimals: number,
): bigint {
  assertPositiveAmount(usdcIn, "usdcIn");
  assertPositivePrice(priceUsdcPerWholeToken);
  assertStockDecimals(stockDecimals);
  const scale = 10n ** BigInt(stockDecimals);
  return assertUint256((usdcIn * scale) / priceUsdcPerWholeToken, "stockOut");
}

/**
 * USDC received for a given stock input.
 *
 *   usdcOut = floor(stockIn * price6 / 10^stockDecimals)
 */
export function calculateSellUsdcOut(
  stockIn: bigint,
  priceUsdcPerWholeToken: bigint,
  stockDecimals: number,
): bigint {
  assertPositiveAmount(stockIn, "stockIn");
  assertPositivePrice(priceUsdcPerWholeToken);
  assertStockDecimals(stockDecimals);
  const scale = 10n ** BigInt(stockDecimals);
  return assertUint256((stockIn * priceUsdcPerWholeToken) / scale, "usdcOut");
}

/** Floor of `quoted * (10000 - bps) / 10000`. A 0 bps tolerance returns the quote. */
export function calculateMinAmountOut(quotedAmount: bigint, maxSlippageBps: number): bigint {
  assertPositiveAmount(quotedAmount, "quotedAmount");
  const bps = BigInt(assertSlippageBps(maxSlippageBps));
  return (quotedAmount * (10_000n - bps)) / 10_000n;
}

export interface CreateQuoteOptions {
  readonly nowSeconds: number;
  /** Chain the quote is bound to. Base Sepolia is 84532. */
  readonly chainId: number;
  readonly freshnessConfig: AssetFreshnessConfig;
  readonly session: MarketSession;
  readonly priceBounds: PriceBounds;
  readonly quoteTtlSeconds?: number;
}

/**
 * Build a quote from a validated observation.
 *
 * Freshness is computed here from the observation's original `sourceUpdatedAt`.
 * Callers cannot assert that a stale price is fresh.
 */
export function createQuote(
  request: QuoteRequest,
  asset: AssetDefinition,
  observation: PriceObservation,
  options: CreateQuoteOptions,
): Quote {
  assertAssetDefinition(asset);
  assertTradeSide(request.side);

  if (asset.symbol !== request.assetSymbol) {
    throw new CoreError("QUOTE_MISMATCH", "Asset definition does not match the quote request.");
  }
  if (!asset.listed) {
    throw new CoreError("ASSET_DISABLED", `Asset ${asset.symbol} is not listed.`);
  }
  if (observation.assetSymbol !== asset.symbol) {
    throw new CoreError(
      "QUOTE_MISMATCH",
      `Observation is for ${observation.assetSymbol}, not ${asset.symbol}.`,
    );
  }
  if (observation.sourceKind !== asset.priceSourceKind) {
    throw new CoreError(
      "QUOTE_MISMATCH",
      `Observation source kind ${observation.sourceKind} does not match ${asset.priceSourceKind}.`,
    );
  }
  if (!Number.isInteger(options.nowSeconds) || options.nowSeconds <= 0) {
    throw new CoreError("INVALID_TIMESTAMP", "nowSeconds must be a positive integer.");
  }
  if (!Number.isInteger(options.chainId) || options.chainId <= 0) {
    throw new CoreError("QUOTE_MISMATCH", "chainId must be a positive integer.");
  }

  assertPositiveAmount(request.amountIn, "amountIn");
  assertSlippageBps(request.maxSlippageBps);
  assertPriceObservation(observation, options.nowSeconds);
  assertPriceWithinBounds(observation.priceUsdcPerWholeToken, options.priceBounds);

  const freshness = assessFreshness(
    observation,
    options.freshnessConfig,
    options.nowSeconds,
    options.session,
  );
  if (!freshness.fresh) {
    throw new CoreError(
      "STALE_PRICE",
      `Price for ${asset.symbol} is not usable: ${freshness.reason}.`,
    );
  }

  const ttl = options.quoteTtlSeconds ?? DEFAULT_QUOTE_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl <= 0) {
    throw new CoreError("INVALID_TIMESTAMP", "Quote TTL must be a positive integer.");
  }

  const amountOut =
    request.side === "buy"
      ? calculateBuyStockOut(
          request.amountIn,
          observation.priceUsdcPerWholeToken,
          asset.stockDecimals,
        )
      : calculateSellUsdcOut(
          request.amountIn,
          observation.priceUsdcPerWholeToken,
          asset.stockDecimals,
        );

  if (amountOut <= 0n) {
    throw new CoreError(
      "ZERO_OUTPUT",
      `Amount is too small to produce a non-zero ${request.side} output at this price.`,
    );
  }

  return {
    assetSymbol: asset.symbol,
    stockToken: asset.stockToken,
    chainId: options.chainId,
    side: request.side,
    stockDecimals: asset.stockDecimals,
    priceUsdcPerWholeToken: observation.priceUsdcPerWholeToken,
    amountIn: request.amountIn,
    amountOut,
    minAmountOut: calculateMinAmountOut(amountOut, request.maxSlippageBps),
    sourceRoundId: observation.sourceRoundId,
    sourceUpdatedAt: observation.sourceUpdatedAt,
    expiresAt: options.nowSeconds + ttl,
    sourceKind: observation.sourceKind,
    sourceChainId: observation.sourceChainId,
    feedAddress: observation.feedAddress,
    freshness,
  };
}

/** USDC notional a quote is judged on: spend for a buy, proceeds for a sell. */
export function quoteNotionalUsdc(quote: Quote): bigint {
  assertTradeSide(quote.side);
  return quote.side === "buy" ? quote.amountIn : quote.amountOut;
}
