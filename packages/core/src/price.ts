import type { Address, PriceSourceKind } from "./assets.js";
import { CoreError } from "./errors.js";

/**
 * The single price convention in KYROX:
 * the price of ONE WHOLE stock token, denominated in USDC, expressed in
 * 6-decimal USDC base units.
 *
 * `230_000_000n` therefore means 230.000000 USDC per whole token, regardless of
 * how many decimals the stock token itself uses.
 */
export type PriceUsdcPerWholeToken = bigint;

/** Whether the underlying market is open, based on an exchange calendar. */
export type MarketSession = "open" | "closed" | "unknown";

/**
 * Admin-configured plausibility band for one asset.
 *
 * A price outside this band is rejected before it can become tradable, so a
 * unit error or a compromised publisher cannot turn the venue into an
 * unlimited mint.
 */
export interface PriceBounds {
  readonly minPriceUsdcPerWholeToken: bigint;
  readonly maxPriceUsdcPerWholeToken: bigint;
}

/**
 * An immutable record of one oracle observation as published to Base Sepolia.
 *
 * `sourceUpdatedAt` is the ORIGINAL source timestamp reported by the feed. It is
 * never rewritten at publication time. `observedAt` is when our service fetched
 * it and is operational metadata only.
 */
export interface PriceObservation {
  readonly assetSymbol: string;
  readonly priceUsdcPerWholeToken: PriceUsdcPerWholeToken;
  readonly sourceRoundId: bigint;
  readonly sourceUpdatedAt: number;
  readonly observedAt: number;
  readonly sourceChainId: number;
  readonly feedAddress: Address | null;
  readonly sourceKind: PriceSourceKind;
}

/** Per-asset freshness rules. Different assets may use different feed schedules. */
export interface AssetFreshnessConfig {
  readonly assetSymbol: string;
  /** Maximum accepted age of `sourceUpdatedAt` at trade time. */
  readonly maxSourceAgeSeconds: number;
  /** Refuse trades unless the market session is explicitly open. */
  readonly requireOpenMarket: boolean;
}

export function assertPriceWithinBounds(
  priceUsdcPerWholeToken: bigint,
  bounds: PriceBounds,
): bigint {
  if (
    bounds.minPriceUsdcPerWholeToken <= 0n ||
    bounds.maxPriceUsdcPerWholeToken < bounds.minPriceUsdcPerWholeToken
  ) {
    throw new CoreError("INVALID_PRICE", "Price bounds are not a coherent positive range.");
  }
  if (
    priceUsdcPerWholeToken < bounds.minPriceUsdcPerWholeToken ||
    priceUsdcPerWholeToken > bounds.maxPriceUsdcPerWholeToken
  ) {
    throw new CoreError(
      "INVALID_PRICE",
      `Price ${priceUsdcPerWholeToken} is outside the configured band [${bounds.minPriceUsdcPerWholeToken}, ${bounds.maxPriceUsdcPerWholeToken}].`,
    );
  }
  return priceUsdcPerWholeToken;
}

export function assertPriceObservation(
  observation: PriceObservation,
  nowSeconds: number,
): PriceObservation {
  if (typeof observation.priceUsdcPerWholeToken !== "bigint") {
    throw new CoreError("INVALID_PRICE", "Price must be a bigint in 6-decimal USDC base units.");
  }
  if (observation.priceUsdcPerWholeToken <= 0n) {
    throw new CoreError("INVALID_PRICE", "Price must be a positive 6-decimal USDC amount.");
  }
  if (typeof observation.sourceRoundId !== "bigint" || observation.sourceRoundId <= 0n) {
    throw new CoreError("INVALID_ROUND", "Source round id must be a positive bigint.");
  }
  if (!Number.isInteger(observation.sourceUpdatedAt) || observation.sourceUpdatedAt <= 0) {
    throw new CoreError(
      "INVALID_TIMESTAMP",
      "Source updatedAt must be a positive integer unix timestamp.",
    );
  }
  if (!Number.isInteger(observation.observedAt) || observation.observedAt <= 0) {
    throw new CoreError(
      "INVALID_TIMESTAMP",
      "ObservedAt must be a positive integer unix timestamp.",
    );
  }
  if (!Number.isInteger(observation.sourceChainId) || observation.sourceChainId <= 0) {
    throw new CoreError("INVALID_PRICE", "Source chain id must be a positive integer.");
  }
  if (observation.sourceUpdatedAt > nowSeconds) {
    throw new CoreError(
      "FUTURE_TIMESTAMP",
      `Source updatedAt ${observation.sourceUpdatedAt} is later than current time ${nowSeconds}.`,
    );
  }
  if (observation.sourceKind !== "chainlink-coinbase" && observation.sourceKind !== "simulated") {
    throw new CoreError("INVALID_PRICE", "Price observation has an unknown source kind.");
  }
  if (observation.feedAddress !== null && !/^0x[0-9a-fA-F]{40}$/.test(observation.feedAddress)) {
    throw new CoreError("INVALID_PRICE", "Feed address is malformed.");
  }
  if (observation.feedAddress === null && observation.sourceKind === "chainlink-coinbase") {
    throw new CoreError(
      "INVALID_PRICE",
      "A chainlink-coinbase observation must reference a feed address.",
    );
  }
  if (
    observation.feedAddress !== null &&
    (/^0x0{40}$/i.test(observation.feedAddress) || observation.sourceKind === "simulated")
  ) {
    throw new CoreError(
      "INVALID_PRICE",
      "A simulated observation must not reference a feed address.",
    );
  }
  return observation;
}

export interface FreshnessAssessment {
  readonly fresh: boolean;
  readonly ageSeconds: number;
  readonly session: MarketSession;
  readonly sourceKind: PriceSourceKind;
  readonly reason: "ok" | "stale" | "market-closed" | "market-unknown";
}

/**
 * Judge freshness from the ORIGINAL oracle timestamp only.
 *
 * A 24/5 feed keeps its contract callable on weekends while `updatedAt` stops
 * advancing. Age is therefore computed against `sourceUpdatedAt`; copying the
 * value forward with a new timestamp is never allowed.
 */
export function assessFreshness(
  observation: PriceObservation,
  config: AssetFreshnessConfig,
  nowSeconds: number,
  session: MarketSession,
): FreshnessAssessment {
  if (!Number.isInteger(nowSeconds) || nowSeconds <= 0) {
    throw new CoreError("INVALID_TIMESTAMP", "Current time must be a positive integer timestamp.");
  }
  if (!Number.isInteger(config.maxSourceAgeSeconds) || config.maxSourceAgeSeconds <= 0) {
    throw new CoreError("INVALID_TIMESTAMP", "maxSourceAgeSeconds must be a positive integer.");
  }
  if (typeof config.requireOpenMarket !== "boolean") {
    throw new CoreError("QUOTE_MISMATCH", "requireOpenMarket must be a boolean.");
  }
  if (session !== "open" && session !== "closed" && session !== "unknown") {
    throw new CoreError("QUOTE_MISMATCH", "Market session is invalid.");
  }
  if (config.assetSymbol !== observation.assetSymbol) {
    throw new CoreError(
      "QUOTE_MISMATCH",
      `Freshness config is for ${config.assetSymbol} but the observation is for ${observation.assetSymbol}.`,
    );
  }
  assertPriceObservation(observation, nowSeconds);

  const ageSeconds = nowSeconds - observation.sourceUpdatedAt;

  if (ageSeconds > config.maxSourceAgeSeconds) {
    return {
      fresh: false,
      ageSeconds,
      session,
      sourceKind: observation.sourceKind,
      reason: "stale",
    };
  }
  if (config.requireOpenMarket && session !== "open") {
    return {
      fresh: false,
      ageSeconds,
      session,
      sourceKind: observation.sourceKind,
      reason: session === "closed" ? "market-closed" : "market-unknown",
    };
  }
  return { fresh: true, ageSeconds, session, sourceKind: observation.sourceKind, reason: "ok" };
}

/** True when a price came from a labelled simulation and must be described as such. */
export function isSimulatedPrice(observation: PriceObservation): boolean {
  return observation.sourceKind === "simulated";
}
