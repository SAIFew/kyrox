import { describe, expect, it } from "vitest";

import {
  CoreError,
  MAX_SLIPPAGE_BPS,
  MAX_UINT256,
  ROUNDING_DIRECTION,
  calculateBuyStockOut,
  calculateMinAmountOut,
  calculateSellUsdcOut,
  createQuote,
  quoteNotionalUsdc,
} from "../src/index.js";
import {
  NOW,
  PRICE,
  USDC,
  asset,
  assetFor,
  buildQuote,
  observation,
  priceBounds,
  quoteOptions,
} from "./helpers.js";

describe("rounding", () => {
  it("declares a single direction: down", () => {
    expect(ROUNDING_DIRECTION).toBe("down");
  });
});

describe("buy calculation", () => {
  it("converts one USDC at 230 USDC per token into 18-decimal stock units", () => {
    expect(calculateBuyStockOut(1_000_000n, PRICE, 18)).toBe(4_347_826_086_956_521n);
  });

  it("floors the result rather than rounding up", () => {
    expect(calculateBuyStockOut(1n, 3_000_000n, 18)).toBe(333_333_333_333n);
    expect(calculateBuyStockOut(7n, 3n, 6)).toBe(2_333_333n);
  });

  it("honours 6-, 8- and 18-decimal tokens", () => {
    expect(calculateBuyStockOut(1_000_000n, PRICE, 6)).toBe(4_347n);
    expect(calculateBuyStockOut(1_000_000n, PRICE, 8)).toBe(434_782n);
    expect(calculateBuyStockOut(1_000_000n, PRICE, 18)).toBe(4_347_826_086_956_521n);
  });
});

describe("sell calculation", () => {
  it("converts one whole 18-decimal token into USDC units", () => {
    expect(calculateSellUsdcOut(10n ** 18n, PRICE, 18)).toBe(PRICE);
  });

  it("floors fractional proceeds", () => {
    expect(calculateSellUsdcOut(1n, PRICE, 8)).toBe(2n);
    expect(calculateSellUsdcOut(1n, PRICE, 18)).toBe(0n);
  });

  it("honours 6-, 8- and 18-decimal tokens", () => {
    expect(calculateSellUsdcOut(1_000_000n, PRICE, 6)).toBe(PRICE);
    expect(calculateSellUsdcOut(100_000_000n, PRICE, 8)).toBe(PRICE);
    expect(calculateSellUsdcOut(10n ** 18n, PRICE, 18)).toBe(PRICE);
  });
});

describe("amount validation", () => {
  it("rejects zero and negative amounts", () => {
    expect(() => calculateBuyStockOut(0n, PRICE, 18)).toThrow(CoreError);
    expect(() => calculateBuyStockOut(-1n, PRICE, 18)).toThrow(CoreError);
    expect(() => calculateSellUsdcOut(0n, PRICE, 18)).toThrow(CoreError);
    expect(() => calculateSellUsdcOut(-1n, PRICE, 18)).toThrow(CoreError);
  });

  it("rejects zero and negative prices", () => {
    expect(() => calculateBuyStockOut(1_000_000n, 0n, 18)).toThrow(CoreError);
    expect(() => calculateSellUsdcOut(1_000_000n, -1n, 18)).toThrow(CoreError);
  });

  it("rejects non-bigint amounts and values beyond uint256", () => {
    expect(() => calculateBuyStockOut(1 as unknown as bigint, PRICE, 18)).toThrow(CoreError);
    expect(() => calculateBuyStockOut(MAX_UINT256 + 1n, PRICE, 18)).toThrow(CoreError);
    expect(() => calculateBuyStockOut(MAX_UINT256, 1n, 18)).toThrow(CoreError);
  });
});

describe("minimum output", () => {
  it("returns the quote unchanged at zero slippage", () => {
    expect(calculateMinAmountOut(1_000_000n, 0)).toBe(1_000_000n);
  });

  it("floors the tolerance calculation", () => {
    expect(calculateMinAmountOut(4_347_826_086_956_521n, 50)).toBe(4_326_086_956_521_738n);
    expect(calculateMinAmountOut(1_000_000_000n, 1_000)).toBe(900_000_000n);
  });

  it("rejects out-of-range slippage and zero quotes", () => {
    expect(() => calculateMinAmountOut(1_000_000n, -1)).toThrow(CoreError);
    expect(() => calculateMinAmountOut(1_000_000n, MAX_SLIPPAGE_BPS + 1)).toThrow(CoreError);
    expect(() => calculateMinAmountOut(1_000_000n, 1.5)).toThrow(CoreError);
    expect(() => calculateMinAmountOut(0n, 0)).toThrow(CoreError);
  });
});

describe("quotes", () => {
  it("is deterministic for identical inputs", () => {
    expect(buildQuote()).toEqual(buildQuote());
  });

  it("pins the price convention, chain, and source metadata", () => {
    const quote = buildQuote({ maxSlippageBps: 50 });
    expect(quote.chainId).toBe(84532);
    expect(quote.stockToken).toBeNull();
    expect(quote.priceUsdcPerWholeToken).toBe(PRICE);
    expect(quote.sourceRoundId).toBe(11n);
    expect(quote.sourceUpdatedAt).toBe(NOW - 5);
    expect(quote.expiresAt).toBe(NOW + 60);
    expect(quote.amountOut).toBe(4_347_826_086_956_521n);
    expect(quote.minAmountOut).toBe(4_326_086_956_521_738n);
    expect(quote.freshness.fresh).toBe(true);
  });

  it("quotes sells on the USDC side", () => {
    const quote = buildQuote({ side: "sell", amountIn: 10n ** 18n });
    expect(quote.amountOut).toBe(PRICE);
    expect(quoteNotionalUsdc(quote)).toBe(PRICE);
  });

  it("computes freshness itself and refuses a stale observation", () => {
    expect(() => buildQuote({}, {}, observation({ sourceUpdatedAt: NOW - 120 }))).toThrow(
      CoreError,
    );
  });

  it("refuses a closed market session", () => {
    expect(() => buildQuote({}, { session: "closed" })).toThrow(CoreError);
  });

  it("refuses a price outside the configured band", () => {
    expect(() =>
      buildQuote(
        {},
        { priceBounds: { ...priceBounds, minPriceUsdcPerWholeToken: PRICE + 1n } },
        observation(),
      ),
    ).toThrow(CoreError);
    expect(() =>
      buildQuote(
        {},
        { priceBounds: { ...priceBounds, maxPriceUsdcPerWholeToken: 100_000_000n } },
        observation(),
      ),
    ).toThrow(CoreError);
  });

  it("refuses an observation belonging to a different asset or source kind", () => {
    expect(() => buildQuote({}, {}, observation({ assetSymbol: "tTSLA" }))).toThrow(CoreError);
    expect(() =>
      buildQuote(
        {},
        {},
        observation({
          sourceKind: "chainlink-coinbase",
          feedAddress: "0x0000000000000000000000000000000000000001",
        }),
      ),
    ).toThrow(CoreError);
  });

  it("refuses a simulated observation that carries a feed address", () => {
    expect(() =>
      buildQuote(
        {},
        {},
        observation({ feedAddress: "0x0000000000000000000000000000000000000001" }),
      ),
    ).toThrow(CoreError);
  });

  it("refuses non-integer or non-positive time and chain ids", () => {
    expect(() => buildQuote({}, { nowSeconds: Number.NaN })).toThrow(CoreError);
    expect(() => buildQuote({}, { nowSeconds: Number.POSITIVE_INFINITY })).toThrow(CoreError);
    expect(() => buildQuote({}, { nowSeconds: 1.5 })).toThrow(CoreError);
    expect(() => buildQuote({}, { chainId: 0 })).toThrow(CoreError);
  });

  it("refuses zero-output trades instead of quoting them", () => {
    expect(() => buildQuote({ side: "sell", amountIn: 1n })).toThrow(CoreError);
  });

  it("refuses delisted assets and mismatched requests", () => {
    expect(() =>
      createQuote(
        { assetSymbol: "tAAPL", side: "buy", amountIn: USDC, maxSlippageBps: 0 },
        { ...asset, listed: false },
        observation(),
        quoteOptions(),
      ),
    ).toThrow(CoreError);
    expect(() => buildQuote({ assetSymbol: "tTSLA" })).toThrow(CoreError);
  });

  it("rejects a zero TTL and invalid asset decimals", () => {
    expect(() => buildQuote({}, { quoteTtlSeconds: 0 })).toThrow(CoreError);
    expect(() =>
      createQuote(
        { assetSymbol: "tAAPL", side: "buy", amountIn: USDC, maxSlippageBps: 0 },
        assetFor(12),
        observation(),
        quoteOptions(),
      ),
    ).toThrow(CoreError);
  });
});
