import { TESTNET_ASSETS, isSupportedStockDecimals } from "./assets.js";
import { BASE_SEPOLIA_CHAIN_ID } from "./chains.js";
import { CoreError, type CoreErrorCode } from "./errors.js";
import type { AssetFreshnessConfig, MarketSession, PriceBounds } from "./price.js";
import { assertPriceWithinBounds } from "./price.js";
import { assertTradeSide, quoteNotionalUsdc, type Quote } from "./quote.js";

/**
 * Testnet trading policy.
 *
 * All amounts are 6-decimal USDC base units. Mainnet policy is intentionally
 * not defined in this package; it must live behind a separate configuration and
 * must never be selected implicitly.
 */
export interface TradePolicyConfig {
  readonly minTradeUsdc: bigint;
  readonly maxTradeUsdc: bigint;
  readonly dailyLimitUsdc: bigint;
  readonly allowedAssets: readonly string[];
}

export const TESTNET_TRADE_POLICY: TradePolicyConfig = {
  minTradeUsdc: 1_000_000n, // 1 tUSDC
  maxTradeUsdc: 1_000_000_000n, // 1,000 tUSDC
  dailyLimitUsdc: 5_000_000_000n, // 5,000 tUSDC
  // Keep the allowlist in lockstep with the tradable catalogue so the two
  // surfaces cannot drift apart as assets are added or delisted.
  allowedAssets: TESTNET_ASSETS.filter((asset) => asset.listed).map((asset) => asset.symbol),
};

export const SECONDS_PER_UTC_DAY = 86_400;

export interface PolicyContext {
  readonly nowSeconds: number;
  /** UTC day number (`floor(nowSeconds / 86400)`). Checked, never assumed. */
  readonly utcDay: number;
  /** Already-settled spend for the current UTC day, in 6-decimal USDC. */
  readonly dailySpentUsdc: bigint;
  readonly exchangePaused: boolean;
  readonly assetEnabled: boolean;
  readonly session: MarketSession;
  readonly freshness: AssetFreshnessConfig;
  readonly priceBounds: PriceBounds;
}

export interface PolicyViolation {
  readonly code: CoreErrorCode;
  readonly message: string;
}

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly violations: readonly PolicyViolation[];
}

function reject(code: CoreErrorCode, message: string): PolicyViolation {
  return { code, message };
}

function assertPolicyConfig(config: TradePolicyConfig): void {
  if (config.minTradeUsdc <= 0n) {
    throw new CoreError("INVALID_AMOUNT", "minTradeUsdc must be positive.");
  }
  if (config.maxTradeUsdc < config.minTradeUsdc) {
    throw new CoreError("INVALID_AMOUNT", "maxTradeUsdc must be at least minTradeUsdc.");
  }
  if (config.dailyLimitUsdc < config.maxTradeUsdc) {
    throw new CoreError(
      "INVALID_AMOUNT",
      "dailyLimitUsdc must be at least maxTradeUsdc for a coherent policy.",
    );
  }
}

/**
 * Deterministic policy evaluation.
 *
 * Returns every violation in a stable order instead of throwing, so the caller
 * can show complete, reproducible rejections. The agent may explain this output;
 * it may never override it.
 *
 * Freshness, price plausibility, and the UTC day are recomputed from the quote's
 * provenance, never taken from a caller-supplied flag.
 */
export function evaluateTradePolicy(
  quote: Quote,
  config: TradePolicyConfig,
  context: PolicyContext,
): PolicyDecision {
  assertPolicyConfig(config);
  assertTradeSide(quote.side);
  if (!isSupportedStockDecimals(quote.stockDecimals)) {
    throw new CoreError("INVALID_DECIMALS", "Quote stock decimals are unsupported.");
  }

  if (!Number.isInteger(context.nowSeconds) || context.nowSeconds <= 0) {
    throw new CoreError("INVALID_TIMESTAMP", "nowSeconds must be a positive integer.");
  }
  if (context.utcDay !== Math.floor(context.nowSeconds / SECONDS_PER_UTC_DAY)) {
    throw new CoreError(
      "INVALID_TIMESTAMP",
      `utcDay ${context.utcDay} does not match nowSeconds ${context.nowSeconds}.`,
    );
  }
  if (context.dailySpentUsdc < 0n) {
    throw new CoreError("INVALID_AMOUNT", "dailySpentUsdc must not be negative.");
  }
  if (context.freshness.assetSymbol !== quote.assetSymbol) {
    throw new CoreError(
      "QUOTE_MISMATCH",
      `Freshness config is for ${context.freshness.assetSymbol}, quote is for ${quote.assetSymbol}.`,
    );
  }

  const violations: PolicyViolation[] = [];

  if (context.exchangePaused) {
    violations.push(reject("EXCHANGE_PAUSED", "Exchange is paused."));
  }

  if (!config.allowedAssets.includes(quote.assetSymbol)) {
    violations.push(
      reject("UNSUPPORTED_ASSET", `Asset ${quote.assetSymbol} is not on the allowlist.`),
    );
  }

  if (!context.assetEnabled) {
    violations.push(reject("ASSET_DISABLED", `Asset ${quote.assetSymbol} is disabled.`));
  }

  if (quote.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    violations.push(reject("QUOTE_MISMATCH", "Quote is not bound to Base Sepolia (84532)."));
  }

  if (quote.priceUsdcPerWholeToken <= 0n) {
    violations.push(reject("INVALID_PRICE", "Quote price must be positive."));
  } else {
    try {
      assertPriceWithinBounds(quote.priceUsdcPerWholeToken, context.priceBounds);
    } catch (error) {
      violations.push(
        reject(
          "INVALID_PRICE",
          error instanceof CoreError ? error.message : "Quote price is outside its band.",
        ),
      );
    }
  }

  if (quote.sourceRoundId <= 0n) {
    violations.push(reject("INVALID_ROUND", "Quote round id must be positive."));
  }

  // Recompute freshness from the original source timestamp. A tampered or
  // deserialised quote cannot claim to be fresh while carrying an old value.
  if (quote.sourceUpdatedAt > context.nowSeconds) {
    violations.push(reject("FUTURE_TIMESTAMP", "Quote source timestamp is in the future."));
  } else if (context.nowSeconds - quote.sourceUpdatedAt > context.freshness.maxSourceAgeSeconds) {
    violations.push(reject("STALE_PRICE", "Quote source timestamp exceeds the asset age bound."));
  } else if (context.freshness.requireOpenMarket && context.session !== "open") {
    violations.push(
      reject(
        "MARKET_CLOSED",
        `Market session is ${context.session}; trades require an open market.`,
      ),
    );
  }

  if (quote.expiresAt <= context.nowSeconds) {
    violations.push(reject("QUOTE_EXPIRED", "Quote has expired."));
  }

  const notional = quoteNotionalUsdc(quote);
  if (notional <= 0n) {
    violations.push(reject("ZERO_OUTPUT", "Trade notional must be greater than zero."));
  } else {
    if (notional < config.minTradeUsdc) {
      violations.push(
        reject(
          "TRADE_BELOW_MINIMUM",
          `Trade notional ${notional} is below the ${config.minTradeUsdc} minimum.`,
        ),
      );
    }
    if (notional > config.maxTradeUsdc) {
      violations.push(
        reject(
          "TRADE_ABOVE_MAXIMUM",
          `Trade notional ${notional} is above the ${config.maxTradeUsdc} maximum.`,
        ),
      );
    }
    if (context.dailySpentUsdc + notional > config.dailyLimitUsdc) {
      violations.push(
        reject(
          "DAILY_LIMIT_EXCEEDED",
          `Trade would exceed the ${config.dailyLimitUsdc} daily limit (already spent ${context.dailySpentUsdc}).`,
        ),
      );
    }
  }

  return { allowed: violations.length === 0, violations };
}

/** Throw the first violation as a `CoreError`; useful at API/approval boundaries. */
export function assertPolicyAllows(decision: PolicyDecision): void {
  const first = decision.violations[0];
  if (first !== undefined) {
    throw new CoreError(first.code, first.message);
  }
}

export function remainingDailyLimit(config: TradePolicyConfig, dailySpentUsdc: bigint): bigint {
  if (dailySpentUsdc < 0n) {
    throw new CoreError("INVALID_AMOUNT", "dailySpentUsdc must not be negative.");
  }
  const remaining = config.dailyLimitUsdc - dailySpentUsdc;
  return remaining > 0n ? remaining : 0n;
}

/**
 * Safe, dashboard-editable subset of testnet policy.
 *
 * Admins may tighten limits or remove an asset, but may never widen beyond the
 * launch ceiling. The resolver is pure so the API, admin UI and tests agree.
 */
export interface EditablePolicy {
  readonly minTradeUsdc: bigint;
  readonly maxTradeUsdc: bigint;
  readonly dailyLimitUsdc: bigint;
  readonly allowedAssets: readonly string[];
  readonly tradingEnabled: boolean;
}

export const TESTNET_POLICY_CEILING = Object.freeze({
  minTradeUsdc: 1_000_000n,
  maxTradeUsdc: 1_000_000_000n,
  dailyLimitUsdc: 5_000_000_000n,
});

function policyReject(message: string): never {
  throw new CoreError("INVALID_AMOUNT", message);
}

export function resolveEditablePolicy(input: {
  readonly minTradeUsdc?: bigint;
  readonly maxTradeUsdc?: bigint;
  readonly dailyLimitUsdc?: bigint;
  readonly allowedAssets?: readonly string[];
  readonly tradingEnabled?: boolean;
}): EditablePolicy {
  const min = input.minTradeUsdc ?? TESTNET_TRADE_POLICY.minTradeUsdc;
  const max = input.maxTradeUsdc ?? TESTNET_TRADE_POLICY.maxTradeUsdc;
  const daily = input.dailyLimitUsdc ?? TESTNET_TRADE_POLICY.dailyLimitUsdc;
  if (min < TESTNET_POLICY_CEILING.minTradeUsdc) {
    policyReject("The minimum trade cannot be below the launch minimum.");
  }
  if (max > TESTNET_POLICY_CEILING.maxTradeUsdc) {
    policyReject("The maximum trade cannot exceed the launch maximum.");
  }
  if (max < min) policyReject("The maximum trade must be at least the minimum.");
  if (daily > TESTNET_POLICY_CEILING.dailyLimitUsdc) {
    policyReject("The daily limit cannot exceed the launch daily limit.");
  }
  if (daily < max) policyReject("The daily limit must be at least the maximum trade.");

  const ceilingAssets = TESTNET_ASSETS.filter((asset) => asset.listed).map((asset) => asset.symbol);
  const requested = input.allowedAssets ?? ceilingAssets;
  if (requested.length === 0) policyReject("At least one asset must remain enabled.");
  const unique = [...new Set(requested)];
  if (unique.length !== requested.length) policyReject("The asset allowlist contains duplicates.");
  if (unique.some((symbol) => !ceilingAssets.includes(symbol))) {
    policyReject("The asset allowlist cannot include an unlisted asset.");
  }

  return {
    minTradeUsdc: min,
    maxTradeUsdc: max,
    dailyLimitUsdc: daily,
    allowedAssets: unique,
    tradingEnabled: input.tradingEnabled ?? true,
  };
}

export function tradePolicyFromEditable(policy: EditablePolicy): TradePolicyConfig {
  return {
    minTradeUsdc: policy.minTradeUsdc,
    maxTradeUsdc: policy.maxTradeUsdc,
    dailyLimitUsdc: policy.dailyLimitUsdc,
    allowedAssets: policy.allowedAssets,
  };
}
