import { describe, expect, it } from "vitest";

import { toBaseUnits } from "@kyrox/core";

import {
  applyFill,
  balanceOf,
  defaultDemoLedger,
  demoPortfolio,
  type DemoSession,
} from "../lib/demo/session.js";

const NOW = 1_800_000_000;
const ADDRESS = "0x1111111111111111111111111111111111111111" as const;

function session(): DemoSession {
  return {
    address: ADDRESS,
    expiresAt: NOW + 3_600,
    demo: true,
    ledger: defaultDemoLedger(),
  };
}

function avgCost(costUsdc: bigint, amount: bigint, decimals = 18): bigint {
  return (costUsdc * 10n ** BigInt(decimals)) / amount;
}

describe("simulated average cost and P&L", () => {
  it("seeds a simulated scenario cost basis without changing balances", () => {
    const ledger = defaultDemoLedger();
    expect(ledger.balances["tUSDC"]).toBe("25000000000");
    expect(ledger.balances["tAAPL"]).toBe("12500000000000000000");
    expect(ledger.balances["tTSLA"]).toBe("4000000000000000000");
    expect(ledger.balances["tNVDA"]).toBe("8000000000000000000");
    expect(Object.keys(ledger.costBasis ?? {})).toHaveLength(
      Object.keys(ledger.balances).length - 1,
    );
  });

  it("reports simulated average cost and P&L versus that cost", () => {
    const portfolio = demoPortfolio(session(), NOW);
    const aapl = portfolio.positions.find((entry) => entry.symbol === "tAAPL");
    expect(aapl).toBeDefined();
    expect(aapl?.simulated).toBe(true);
    expect(aapl?.avgCostUsdc).toBe("262.5");
    expect(aapl?.costBasisUsdc).toBe("3281.25");
    const expectedPnl = Number(aapl?.valueUsdc ?? "0") - 3281.25;
    expect(Number(aapl?.unrealizedPnlUsdc)).toBeCloseTo(expectedPnl, 6);
    expect(aapl?.unrealizedPnlPct).toBeCloseTo(
      Math.floor((expectedPnl / 3281.25) * 10_000) / 100,
      6,
    );

    const tsla = portfolio.positions.find((entry) => entry.symbol === "tTSLA");
    expect(tsla?.avgCostUsdc).toBe("448");
    const nvda = portfolio.positions.find((entry) => entry.symbol === "tNVDA");
    expect(nvda?.avgCostUsdc).toBe("184.2");
  });

  it("updates a weighted average cost basis on a simulated buy", () => {
    const before = session();
    const amountIn = 10_000_000n; // 10 tUSDC
    const amountOut = toBaseUnits("4", 18);
    const result = applyFill(before, {
      symbol: "tAAPL",
      side: "buy",
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      priceUsdc: "250000000",
    });

    const basis = result.session.ledger.costBasis?.["tAAPL"];
    expect(basis).toEqual({
      amount: toBaseUnits("16.5", 18).toString(),
      costUsdc: toBaseUnits("3291.25", 6).toString(),
    });
    expect(result.fill.avgCostUsdc).toBe(
      avgCost(toBaseUnits("3291.25", 6), toBaseUnits("16.5", 18)).toString(),
    );
    expect(balanceOf(result.session, "tUSDC")).toBe(24_990_000_000n);
    expect(balanceOf(result.session, "tAAPL")).toBe(toBaseUnits("16.5", 18));
    // The original session is immutable.
    expect(balanceOf(before, "tUSDC")).toBe(25_000_000_000n);
    expect(before.ledger.costBasis?.["tAAPL"]?.costUsdc).toBe("3281250000");
  });

  it("releases basis proportionally and records realised P&L on a simulated sell", () => {
    const bought = applyFill(session(), {
      symbol: "tAAPL",
      side: "buy",
      amountIn: "10000000",
      amountOut: toBaseUnits("4", 18).toString(),
      priceUsdc: "250000000",
    }).session;

    const soldAmount = toBaseUnits("1.5", 18);
    const proceeds = 375_000_000n;
    const costBefore = toBaseUnits("3291.25", 6);
    const amountBefore = toBaseUnits("16.5", 18);
    const costSold = (costBefore * soldAmount) / amountBefore;

    const sold = applyFill(bought, {
      symbol: "tAAPL",
      side: "sell",
      amountIn: soldAmount.toString(),
      amountOut: proceeds.toString(),
      priceUsdc: "250000000",
    });

    expect(sold.session.ledger.costBasis?.["tAAPL"]).toEqual({
      amount: toBaseUnits("15", 18).toString(),
      costUsdc: (costBefore - costSold).toString(),
    });
    expect(sold.fill.realizedPnlUsdc).toBe((proceeds - costSold).toString());
    expect(sold.fill.avgCostUsdc).toBe(
      avgCost(costBefore - costSold, toBaseUnits("15", 18)).toString(),
    );
    expect(balanceOf(sold.session, "tAAPL")).toBe(toBaseUnits("15", 18));
  });
});
