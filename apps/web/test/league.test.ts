import { describe, expect, it } from "vitest";

import { realizedPnlByWallet, type LeagueTrade } from "../lib/server/league.js";

function trade(overrides: Partial<LeagueTrade>): LeagueTrade {
  return {
    userAddress: "0x1111111111111111111111111111111111111111",
    assetSymbol: "tAAPL",
    side: "buy",
    usdcAmount: 100_000_000n,
    stockAmount: 1_000_000_000_000_000_000n,
    blockTime: new Date("2026-11-20T10:00:00Z"),
    ...overrides,
  };
}

describe("league realised P&L", () => {
  it("uses weighted-average cost and only counts sells in the window", () => {
    const trades = [
      trade({}),
      trade({
        side: "sell",
        usdcAmount: 120_000_000n,
        stockAmount: 1_000_000_000_000_000_000n,
        blockTime: new Date("2026-11-24T10:00:00Z"),
      }),
      trade({
        side: "sell",
        usdcAmount: 50_000_000n,
        stockAmount: 500_000_000_000_000_000n,
        blockTime: new Date("2026-11-19T10:00:00Z"),
      }),
    ];
    const pnl = realizedPnlByWallet(trades, new Date("2026-11-23T00:00:00Z"));
    expect(pnl.get("0x1111111111111111111111111111111111111111")).toBe(20_000_000n);
  });

  it("ignores wallets with no sells in the window", () => {
    const pnl = realizedPnlByWallet([trade({})], new Date("2026-11-23T00:00:00Z"));
    expect(pnl.size).toBe(0);
  });
});
