import { describe, expect, it } from "vitest";

import {
  calculateBuyStockOut,
  calculateMinAmountOut,
  calculateSellUsdcOut,
  createQuote,
  type PriceBounds,
} from "../src/index.js";
import goldenQuotes from "../fixtures/golden-quotes.json";
import { NOW, assetFor, observation, quoteOptions } from "./helpers.js";

const vectors = Object.entries(goldenQuotes.cases);
const wideBounds: PriceBounds = {
  minPriceUsdcPerWholeToken: 1n,
  maxPriceUsdcPerWholeToken: 10n ** 30n,
};

describe("shared golden vectors", () => {
  it("contains the expected number of cases", () => {
    expect(vectors.length).toBe(14);
    expect(Object.keys(goldenQuotes.minOutputCases).length).toBe(4);
  });

  for (const [name, vector] of vectors) {
    it(`${name}: math matches`, () => {
      const price = BigInt(vector.priceUsdcPerWholeToken);
      const amountIn = BigInt(vector.amountIn);
      const expected = BigInt(vector.expectedAmountOut);

      const actual =
        vector.side === "buy"
          ? calculateBuyStockOut(amountIn, price, vector.stockDecimals)
          : calculateSellUsdcOut(amountIn, price, vector.stockDecimals);

      expect(actual).toBe(expected);
    });

    if (BigInt(vector.expectedAmountOut) > 0n) {
      it(`${name}: quote matches`, () => {
        const quote = createQuote(
          {
            assetSymbol: "tAAPL",
            side: vector.side as "buy" | "sell",
            amountIn: BigInt(vector.amountIn),
            maxSlippageBps: 0,
          },
          assetFor(vector.stockDecimals),
          observation({
            priceUsdcPerWholeToken: BigInt(vector.priceUsdcPerWholeToken),
            sourceUpdatedAt: NOW,
          }),
          quoteOptions({
            priceBounds: wideBounds,
            freshnessConfig: {
              assetSymbol: "tAAPL",
              maxSourceAgeSeconds: 60,
              requireOpenMarket: false,
            },
          }),
        );
        expect(quote.amountOut).toBe(BigInt(vector.expectedAmountOut));
        expect(quote.minAmountOut).toBe(BigInt(vector.expectedAmountOut));
      });
    }
  }

  for (const [name, vector] of Object.entries(goldenQuotes.minOutputCases)) {
    it(`${name}: minimum output matches`, () => {
      expect(calculateMinAmountOut(BigInt(vector.quoted), vector.bps)).toBe(
        BigInt(vector.expected),
      );
    });
  }
});
