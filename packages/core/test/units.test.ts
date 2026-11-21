import { describe, expect, it } from "vitest";

import {
  BASE_SEPOLIA_CHAIN_ID,
  fromBaseUnits,
  MAX_TOKEN_DECIMALS,
  toBaseUnits,
  TokenAmountError,
  TUSDC_DECIMALS,
} from "../src/index.js";

describe("chain constants", () => {
  it("pins the product to Base Sepolia", () => {
    expect(BASE_SEPOLIA_CHAIN_ID).toBe(84532);
    expect(TUSDC_DECIMALS).toBe(6);
  });
});

describe("toBaseUnits", () => {
  it("converts tUSDC amounts with 6 decimals", () => {
    expect(toBaseUnits("1", 6)).toBe(1_000_000n);
    expect(toBaseUnits("1.5", 6)).toBe(1_500_000n);
    expect(toBaseUnits("0.000001", 6)).toBe(1n);
  });

  it("converts 18-decimal stock amounts exactly", () => {
    expect(toBaseUnits("10", 18)).toBe(10_000_000_000_000_000_000n);
    expect(toBaseUnits("0.000000000000000001", 18)).toBe(1n);
  });

  it("supports zero and leading zeros", () => {
    expect(toBaseUnits("0", 6)).toBe(0n);
    expect(toBaseUnits("00012.30", 6)).toBe(12_300_000n);
  });

  it("rejects precision beyond the token decimals", () => {
    expect(() => toBaseUnits("1.0000001", 6)).toThrow(TokenAmountError);
  });

  it("rejects floats, exponent notation, negatives, and blanks", () => {
    expect(() => toBaseUnits("1e6", 6)).toThrow(TokenAmountError);
    expect(() => toBaseUnits("-1", 6)).toThrow(TokenAmountError);
    expect(() => toBaseUnits("", 6)).toThrow(TokenAmountError);
    expect(() => toBaseUnits(" 1.0 ", 6)).not.toThrow();
  });

  it("rejects invalid decimals", () => {
    expect(() => toBaseUnits("1", -1)).toThrow(TokenAmountError);
    expect(() => toBaseUnits("1", MAX_TOKEN_DECIMALS + 1)).toThrow(TokenAmountError);
    expect(() => toBaseUnits("1", 1.5)).toThrow(TokenAmountError);
  });
});

describe("fromBaseUnits", () => {
  it("round-trips tUSDC and 18-decimal amounts", () => {
    expect(fromBaseUnits(1_500_000n, 6)).toBe("1.5");
    expect(fromBaseUnits(10_000_000_000_000_000_000n, 18)).toBe("10");
    expect(fromBaseUnits(1n, 18)).toBe("0.000000000000000001");
  });

  it("trims trailing zeros and handles zero decimals", () => {
    expect(fromBaseUnits(0n, 6)).toBe("0");
    expect(fromBaseUnits(12_300_000n, 6)).toBe("12.3");
    expect(fromBaseUnits(42n, 0)).toBe("42");
  });

  it("rejects negative base units", () => {
    expect(() => fromBaseUnits(-1n, 6)).toThrow(TokenAmountError);
  });
});
