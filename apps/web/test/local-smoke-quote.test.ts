import { describe, expect, it } from "vitest";

import { quoteFrom } from "../../../scripts/local-smoke.js";

const flatQuote = {
  quoteId: "quote-1",
  quoteToken: "signed-token",
  amountIn: "1000000",
  amountOut: "2896051759349126",
};

describe("local smoke quote response compatibility", () => {
  it("prefers the current nested quote envelope", () => {
    expect(
      quoteFrom({
        ...flatQuote,
        quoteId: "outer-value-must-not-win",
        quote: { ...flatQuote, amountOutLabel: "0.002896051759349126" },
      }),
    ).toEqual({
      ...flatQuote,
      amountOutLabel: "0.002896051759349126",
    });
  });

  it("accepts the former flat quote response", () => {
    expect(quoteFrom(flatQuote)).toEqual(flatQuote);
    expect(quoteFrom({ quote: null, ...flatQuote })).toEqual(flatQuote);
  });

  it("fails clearly for malformed quote envelopes", () => {
    for (const payload of [null, [], {}, { quote: {} }, { ...flatQuote, quoteToken: 42 }]) {
      expect(() => quoteFrom(payload)).toThrow(/Quote response/);
    }
  });
});
