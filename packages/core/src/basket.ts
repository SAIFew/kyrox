import { CoreError } from "./errors.js";
import type { PolicyViolation, TradePolicyConfig } from "./policy.js";

/** A portfolio request is capped at four legs, matching the Testnet MVP plan. */
export const MAX_BASKET_LEGS = 4;

export interface BasketLegInput {
  readonly symbol: string;
  /** 6-decimal tUSDC base units committed to this leg. */
  readonly amountInUsdc: bigint;
}

export interface BasketSummary {
  readonly legs: readonly BasketLegInput[];
  readonly totalUsdc: bigint;
}

function reject(message: string): never {
  throw new CoreError("INVALID_AMOUNT", message);
}

/** Validate shape, duplicates, allowlist, and the four-leg ceiling. */
export function validateBasket(
  legs: readonly BasketLegInput[],
  allowedAssets: readonly string[],
): BasketSummary {
  if (legs.length === 0) reject("A basket needs at least one leg.");
  if (legs.length > MAX_BASKET_LEGS) {
    reject(`A basket can contain at most ${MAX_BASKET_LEGS} legs.`);
  }

  const seen = new Set<string>();
  let total = 0n;
  for (const leg of legs) {
    if (!/^t[A-Z]{2,6}$/.test(leg.symbol)) {
      reject(`Invalid basket asset: ${leg.symbol}.`);
    }
    if (!allowedAssets.includes(leg.symbol)) {
      reject(`${leg.symbol} is not on the asset allowlist.`);
    }
    if (seen.has(leg.symbol)) {
      reject(`${leg.symbol} appears twice; combine it into one leg.`);
    }
    seen.add(leg.symbol);
    if (leg.amountInUsdc <= 0n) {
      reject("Every basket leg must be greater than zero.");
    }
    total += leg.amountInUsdc;
  }
  return { legs, totalUsdc: total };
}

/**
 * Basket policy is applied per leg and to the aggregate. This prevents four
 * individually valid legs from bypassing the daily notional limit.
 */
export function evaluateBasketPolicy(
  summary: BasketSummary,
  config: TradePolicyConfig,
  dailySpentUsdc: bigint,
  tradingEnabled = true,
): readonly PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const push = (code: PolicyViolation["code"], message: string) =>
    violations.push({ code, message });

  if (!tradingEnabled) push("EXCHANGE_PAUSED", "Testnet trading is paused right now.");
  for (const leg of summary.legs) {
    if (leg.amountInUsdc < config.minTradeUsdc) {
      push(
        "TRADE_BELOW_MINIMUM",
        `${leg.symbol} is below the ${config.minTradeUsdc} minimum trade size.`,
      );
    }
    if (leg.amountInUsdc > config.maxTradeUsdc) {
      push(
        "TRADE_ABOVE_MAXIMUM",
        `${leg.symbol} is above the ${config.maxTradeUsdc} maximum trade size.`,
      );
    }
  }
  if (dailySpentUsdc + summary.totalUsdc > config.dailyLimitUsdc) {
    push(
      "DAILY_LIMIT_EXCEEDED",
      `The basket would exceed the ${config.dailyLimitUsdc} daily limit.`,
    );
  }
  return violations;
}

/**
 * Allocate a total budget across selected assets using integer weights.
 * The final leg receives the remainder so the parts always sum to the budget.
 */
export function allocateBasketBudget(
  symbols: readonly string[],
  totalUsdc: bigint,
  weights?: readonly number[],
): readonly BasketLegInput[] {
  if (symbols.length === 0 || symbols.length > MAX_BASKET_LEGS) {
    reject(`Choose between 1 and ${MAX_BASKET_LEGS} assets.`);
  }
  if (totalUsdc <= 0n) reject("The basket budget must be positive.");
  const resolved = weights ?? symbols.map(() => 1);
  if (resolved.length !== symbols.length) {
    reject("Each basket asset needs exactly one weight.");
  }
  if (resolved.some((weight) => !Number.isSafeInteger(weight) || weight <= 0)) {
    reject("Basket weights must be positive integers.");
  }
  const sum = resolved.reduce((total, weight) => total + BigInt(weight), 0n);
  const legs: BasketLegInput[] = [];
  let allocated = 0n;
  symbols.forEach((symbol, index) => {
    const amount =
      index === symbols.length - 1
        ? totalUsdc - allocated
        : (totalUsdc * BigInt(resolved[index] ?? 1)) / sum;
    allocated += amount;
    legs.push({ symbol, amountInUsdc: amount });
  });
  return legs;
}
