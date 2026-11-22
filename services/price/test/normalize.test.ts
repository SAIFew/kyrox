import { describe, expect, it } from "vitest";

import { CoreError } from "@kyrox/core";

import { MAX_REFERENCE_PRICE, normalizeChainlinkAnswer } from "../src/normalize.js";

describe("Chainlink answer normalization", () => {
  it("converts an 8-decimal equity answer into 6-decimal USDC units", () => {
    // 345.29769685 USD -> 345.297696 USDC (floor), matching the live AAPL feed value.
    expect(normalizeChainlinkAnswer(34_529_769_685n, 8)).toBe(345_297_696n);
  });

  it("leaves 6-decimal answers unchanged", () => {
    expect(normalizeChainlinkAnswer(230_000_000n, 6)).toBe(230_000_000n);
  });

  it("scales 18-decimal answers", () => {
    expect(normalizeChainlinkAnswer(230n * 10n ** 18n, 18)).toBe(230_000_000n);
  });

  it("floors instead of rounding up", () => {
    expect(normalizeChainlinkAnswer(100n, 8)).toBe(1n);
    expect(normalizeChainlinkAnswer(199n, 8)).toBe(1n);
    expect(normalizeChainlinkAnswer(230_000_000_99n, 8)).toBe(230_000_000n);
    expect(() => normalizeChainlinkAnswer(99n, 8)).toThrow(CoreError);
  });

  it("rejects zero and negative answers", () => {
    expect(() => normalizeChainlinkAnswer(0n, 8)).toThrow(CoreError);
    expect(() => normalizeChainlinkAnswer(-1n, 8)).toThrow(CoreError);
  });

  it("rejects unsupported decimals", () => {
    expect(() => normalizeChainlinkAnswer(1n, -1)).toThrow(CoreError);
    expect(() => normalizeChainlinkAnswer(1n, 19)).toThrow(CoreError);
    expect(() => normalizeChainlinkAnswer(1n, 1.5)).toThrow(CoreError);
  });

  it("rejects answers whose normalization is zero", () => {
    expect(() => normalizeChainlinkAnswer(1n, 18)).toThrow(CoreError);
  });

  it("rejects an implausibly large normalized price", () => {
    expect(() => normalizeChainlinkAnswer((MAX_REFERENCE_PRICE + 1n) * 10n ** 8n, 8)).toThrow(
      CoreError,
    );
  });
});
