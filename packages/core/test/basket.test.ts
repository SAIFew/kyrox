import { describe, expect, it } from "vitest";

import {
  MAX_BASKET_LEGS,
  allocateBasketBudget,
  evaluateBasketPolicy,
  validateBasket,
} from "../src/basket.js";
import { TESTNET_TRADE_POLICY } from "../src/policy.js";

const ALLOWED = ["tAAPL", "tNVDA", "tMSFT", "tGOOGL", "tAMZN", "tTSLA", "tMETA"];

describe("basket validation", () => {
  it("accepts up to four distinct allowlisted legs and sums the notional", () => {
    const summary = validateBasket(
      [
        { symbol: "tAAPL", amountInUsdc: 100_000_000n },
        { symbol: "tNVDA", amountInUsdc: 200_000_000n },
      ],
      ALLOWED,
    );
    expect(summary.totalUsdc).toBe(300_000_000n);
    expect(MAX_BASKET_LEGS).toBe(4);
  });

  it("rejects duplicates, unsupported assets, empty baskets, and five legs", () => {
    expect(() =>
      validateBasket(
        [
          { symbol: "tAAPL", amountInUsdc: 1n },
          { symbol: "tAAPL", amountInUsdc: 1n },
        ],
        ALLOWED,
      ),
    ).toThrow(/twice/);
    expect(() => validateBasket([{ symbol: "tDOGE", amountInUsdc: 1n }], ALLOWED)).toThrow(
      /allowlist/,
    );
    expect(() => validateBasket([], ALLOWED)).toThrow(/at least one/);
    expect(() =>
      validateBasket(
        ["tAAPL", "tNVDA", "tMSFT", "tGOOGL", "tAMZN"].map((symbol) => ({
          symbol,
          amountInUsdc: 1_000_000n,
        })),
        ALLOWED,
      ),
    ).toThrow(/at most 4/);
  });
});

describe("basket policy", () => {
  it("enforces each leg and the aggregate daily limit", () => {
    const summary = validateBasket(
      [
        { symbol: "tAAPL", amountInUsdc: 1_000_000_000n },
        { symbol: "tNVDA", amountInUsdc: 1_000_000_000n },
      ],
      ALLOWED,
    );
    const violations = evaluateBasketPolicy(summary, TESTNET_TRADE_POLICY, 4_000_000_000n, true);
    expect(violations.map((violation) => violation.code)).toContain("DAILY_LIMIT_EXCEEDED");
  });

  it("rejects a paused venue", () => {
    const summary = validateBasket([{ symbol: "tAAPL", amountInUsdc: 100_000_000n }], ALLOWED);
    const violations = evaluateBasketPolicy(summary, TESTNET_TRADE_POLICY, 0n, false);
    expect(violations.map((violation) => violation.code)).toContain("EXCHANGE_PAUSED");
  });
});

describe("budget allocation", () => {
  it("allocates the full budget with integer rounding", () => {
    const legs = allocateBasketBudget(["tAAPL", "tNVDA", "tMSFT"], 1_000_000_000n, [1, 1, 1]);
    expect(legs.reduce((total, leg) => total + leg.amountInUsdc, 0n)).toBe(1_000_000_000n);
    expect(legs).toHaveLength(3);
  });
});
