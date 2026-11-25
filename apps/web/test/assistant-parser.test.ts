import { describe, expect, it } from "vitest";

import { parseAssistantQuestion, resolveAssistantSymbol } from "../lib/assistant.js";

describe("assistant grammar", () => {
  it("resolves company aliases and tickers", () => {
    expect(resolveAssistantSymbol("Buy Nvidia")).toBe("tNVDA");
    expect(resolveAssistantSymbol("what is tTSLA at")).toBe("tTSLA");
    expect(resolveAssistantSymbol("hello")).toBeNull();
  });

  it("parses a buy or sell amount", () => {
    expect(parseAssistantQuestion("Buy $100 of Nvidia")).toMatchObject({
      kind: "trade",
      side: "buy",
      symbol: "tNVDA",
      amountUsdc: 100_000_000n,
    });
    expect(parseAssistantQuestion("sell 12.5 of Tesla")).toMatchObject({
      kind: "trade",
      side: "sell",
      symbol: "tTSLA",
      amountUsdc: 12_500_000n,
    });
  });

  it("distinguishes price, portfolio, and basket intents", () => {
    expect(parseAssistantQuestion("What is Tesla at?")).toMatchObject({
      kind: "price",
      symbol: "tTSLA",
    });
    expect(parseAssistantQuestion("How is my portfolio?")).toEqual({ kind: "portfolio" });
    expect(parseAssistantQuestion("Build me a tech portfolio with $500")).toEqual({
      kind: "basket",
      symbols: ["tNVDA", "tMSFT", "tGOOGL", "tAAPL"],
      totalUsdc: 500_000_000n,
    });
  });

  it("returns help instead of guessing", () => {
    expect(parseAssistantQuestion("hello there")).toEqual({ kind: "help" });
  });
});
