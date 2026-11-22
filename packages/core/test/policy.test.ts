import { describe, expect, it } from "vitest";

import {
  CoreError,
  SECONDS_PER_UTC_DAY,
  TESTNET_TRADE_POLICY,
  assertPolicyAllows,
  evaluateTradePolicy,
  remainingDailyLimit,
  type Quote,
  type TradePolicyConfig,
} from "../src/index.js";
import { NOW, USDC, buildQuote, freshnessConfig, policyContext, priceBounds } from "./helpers.js";

const policy: TradePolicyConfig = TESTNET_TRADE_POLICY;

function codes(quoteValue: Quote, ctx = policyContext(), config = policy): string[] {
  return evaluateTradePolicy(quoteValue, config, ctx).violations.map((violation) => violation.code);
}

describe("testnet policy constants", () => {
  it("matches the specification", () => {
    expect(policy.minTradeUsdc).toBe(1n * USDC);
    expect(policy.maxTradeUsdc).toBe(1_000n * USDC);
    expect(policy.dailyLimitUsdc).toBe(5_000n * USDC);
    expect(policy.allowedAssets).toEqual(["tAAPL", "tTSLA", "tNVDA"]);
  });

  it("rejects a self-inconsistent configuration instead of guessing", () => {
    const broken: TradePolicyConfig = { ...policy, maxTradeUsdc: 1n };
    expect(() => evaluateTradePolicy(buildQuote(), broken, policyContext())).toThrow(CoreError);
  });
});

describe("amount limits", () => {
  it("allows exactly the minimum and the maximum", () => {
    expect(codes(buildQuote({ amountIn: 1n * USDC }))).toEqual([]);
    expect(codes(buildQuote({ amountIn: 1_000n * USDC }))).toEqual([]);
  });

  it("rejects below the minimum", () => {
    expect(codes(buildQuote({ amountIn: USDC - 1n }))).toContain("TRADE_BELOW_MINIMUM");
  });

  it("rejects above the maximum", () => {
    expect(codes(buildQuote({ amountIn: 1_000n * USDC + 1n }))).toContain("TRADE_ABOVE_MAXIMUM");
  });

  it("judges sell notional by USDC proceeds, not stock quantity", () => {
    const sell = buildQuote({
      side: "sell",
      amountIn: (1_000n * USDC * 10n ** 18n) / 230_000_000n,
    });
    expect(codes(sell)).toEqual([]);

    const large = buildQuote({
      side: "sell",
      amountIn: (2_000n * USDC * 10n ** 18n) / 230_000_000n,
    });
    expect(codes(large)).toContain("TRADE_ABOVE_MAXIMUM");
  });

  it("rejects a borderline sell that floors just below the minimum", () => {
    expect(codes(buildQuote({ side: "sell", amountIn: 4_347_826_086_956_521n }))).toContain(
      "TRADE_BELOW_MINIMUM",
    );
  });
});

describe("daily limit", () => {
  it("allows a trade that lands exactly on the limit", () => {
    expect(
      codes(
        buildQuote({ amountIn: 1_000n * USDC }),
        policyContext({ dailySpentUsdc: 4_000n * USDC }),
      ),
    ).toEqual([]);
  });

  it("rejects a trade that would exceed the limit", () => {
    expect(
      codes(
        buildQuote({ amountIn: 1_000n * USDC }),
        policyContext({ dailySpentUsdc: 4_000n * USDC + 1n }),
      ),
    ).toContain("DAILY_LIMIT_EXCEEDED");
  });

  it("refuses a UTC day that does not match the clock", () => {
    expect(() =>
      codes(buildQuote(), policyContext({ utcDay: Math.floor(NOW / SECONDS_PER_UTC_DAY) + 1 })),
    ).toThrow(CoreError);
  });

  it("computes the remaining allowance without going negative", () => {
    expect(remainingDailyLimit(policy, 4_500n * USDC)).toBe(500n * USDC);
    expect(remainingDailyLimit(policy, 9_000n * USDC)).toBe(0n);
    expect(() => remainingDailyLimit(policy, -1n)).toThrow(CoreError);
  });

  it("rejects a negative spend input", () => {
    expect(() => codes(buildQuote(), policyContext({ dailySpentUsdc: -1n }))).toThrow(CoreError);
  });
});

describe("operational refusals", () => {
  it("refuses everything while the exchange is paused", () => {
    expect(codes(buildQuote(), policyContext({ exchangePaused: true }))).toEqual([
      "EXCHANGE_PAUSED",
    ]);
  });

  it("refuses assets outside the allowlist", () => {
    const restricted: TradePolicyConfig = { ...policy, allowedAssets: ["tTSLA"] };
    expect(codes(buildQuote(), policyContext(), restricted)).toContain("UNSUPPORTED_ASSET");
  });

  it("refuses disabled assets", () => {
    expect(codes(buildQuote(), policyContext({ assetEnabled: false }))).toContain("ASSET_DISABLED");
  });
});

describe("price and quote validity", () => {
  it("recomputes freshness and rejects a quote that aged past the bound", () => {
    const quote = buildQuote();
    const later = NOW + 56;
    expect(codes(quote, policyContext({ nowSeconds: later }))).toContain("STALE_PRICE");
  });

  it("rejects a quote whose source timestamp was mutated backwards", () => {
    const tampered: Quote = { ...buildQuote(), sourceUpdatedAt: NOW - 500 };
    expect(codes(tampered)).toContain("STALE_PRICE");
  });

  it("rejects a tampered price, round id, or chain id", () => {
    expect(codes({ ...buildQuote(), priceUsdcPerWholeToken: 0n })).toContain("INVALID_PRICE");
    expect(codes({ ...buildQuote(), sourceRoundId: 0n })).toContain("INVALID_ROUND");
    expect(codes({ ...buildQuote(), chainId: 8453 })).toContain("QUOTE_MISMATCH");
  });

  it("rejects a price outside the configured band", () => {
    const tampered: Quote = { ...buildQuote(), priceUsdcPerWholeToken: 10n ** 15n };
    expect(codes(tampered)).toContain("INVALID_PRICE");
  });

  it("refuses a closed or unknown market session", () => {
    expect(codes(buildQuote(), policyContext({ session: "closed" }))).toContain("MARKET_CLOSED");
    expect(codes(buildQuote(), policyContext({ session: "unknown" }))).toContain("MARKET_CLOSED");
  });

  it("refuses an expired quote", () => {
    expect(codes(buildQuote(), policyContext({ nowSeconds: NOW + 61 }))).toContain("QUOTE_EXPIRED");
  });

  it("refuses a quote whose source timestamp is in the future", () => {
    expect(codes({ ...buildQuote(), sourceUpdatedAt: NOW + 1 })).toContain("FUTURE_TIMESTAMP");
  });

  it("refuses freshness config that belongs to another asset", () => {
    expect(() =>
      codes(
        buildQuote(),
        policyContext({ freshness: { ...freshnessConfig, assetSymbol: "tTSLA" } }),
      ),
    ).toThrow(CoreError);
  });

  it("reports every violation in a stable order", () => {
    const result = evaluateTradePolicy(
      buildQuote({ amountIn: 2_000n * USDC }),
      policy,
      policyContext({
        exchangePaused: true,
        assetEnabled: false,
        dailySpentUsdc: 5_000n * USDC,
        priceBounds,
      }),
    );
    expect(result.allowed).toBe(false);
    expect(result.violations.map((violation) => violation.code)).toEqual([
      "EXCHANGE_PAUSED",
      "ASSET_DISABLED",
      "TRADE_ABOVE_MAXIMUM",
      "DAILY_LIMIT_EXCEEDED",
    ]);
  });

  it("throws the first violation with a typed error", () => {
    const decision = evaluateTradePolicy(
      buildQuote(),
      policy,
      policyContext({ exchangePaused: true }),
    );
    expect(() => assertPolicyAllows(decision)).toThrow(CoreError);
    expect(() => assertPolicyAllows({ allowed: true, violations: [] })).not.toThrow();
  });
});
