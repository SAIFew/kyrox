import { describe, expect, it } from "vitest";

import { usdcHuman, valueUnits } from "../lib/server/portfolio.js";

describe("portfolio arithmetic", () => {
  it("values stock holdings with integer math and explicit decimals", () => {
    // 2 whole 18-decimal tokens at 230.000000 USDC.
    expect(valueUnits(2n * 10n ** 18n, 18, 230_000_000n)).toBe(460_000_000n);
    // 1 whole 8-decimal token at 230 USDC.
    expect(valueUnits(10n ** 8n, 8, 230_000_000n)).toBe(230_000_000n);
    expect(valueUnits(1n, 18, 230_000_000n)).toBe(0n);
    expect(valueUnits(1n, 18, null)).toBeNull();
  });

  it("formats USDC without floating point", () => {
    expect(usdcHuman(230_000_000n)).toBe("230.000000");
    expect(usdcHuman(1n)).toBe("0.000001");
  });
});
