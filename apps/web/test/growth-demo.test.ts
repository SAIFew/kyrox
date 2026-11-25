import { describe, expect, it } from "vitest";

import { defaultDemoLedger, type DemoSession } from "../lib/demo/session.js";
import { demoGrowthActivity, demoGrowthSummary } from "../lib/server/growth.js";

function session(overrides: Partial<DemoSession> = {}): DemoSession {
  return {
    address: "0x1111111111111111111111111111111111111111",
    expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
    demo: true,
    ledger: defaultDemoLedger(),
    ...overrides,
  };
}

describe("demo growth", () => {
  it("counts trades, distinct days, held assets, questions, and feedback", () => {
    const base = session();
    const activity = [
      {
        id: "1",
        symbol: "tAAPL",
        side: "buy" as const,
        amountIn: "100000000",
        amountOut: "1000000000000000000",
        priceUsdc: "100000000",
        createdAt: "2026-11-20T10:00:00.000Z",
        reference: "sim",
      },
      {
        id: "2",
        symbol: "tNVDA",
        side: "buy" as const,
        amountIn: "100000000",
        amountOut: "1000000000000000000",
        priceUsdc: "100000000",
        createdAt: "2026-11-21T10:00:00.000Z",
        reference: "sim",
      },
      {
        id: "3",
        symbol: "tMSFT",
        side: "buy" as const,
        amountIn: "100000000",
        amountOut: "1000000000000000000",
        priceUsdc: "100000000",
        createdAt: "2026-11-22T10:00:00.000Z",
        reference: "sim",
      },
    ];
    const withGrowth = session({
      ledger: { ...base.ledger, activity },
      growth: {
        questions: 3,
        feedback: [{ topic: "ux", message: "Clear enough", createdAt: "2026-11-22T11:00:00.000Z" }],
        referredBy: null,
      },
    });
    const derived = demoGrowthActivity(withGrowth);
    expect(derived.tradeCount).toBe(3);
    expect(derived.distinctTradeDays).toBe(3);
    expect(derived.questionsAsked).toBe(3);
    expect(derived.hasFeedback).toBe(true);
    expect(derived.distinctAssetsHeld).toBe(7);
    expect(demoGrowthSummary(withGrowth).points).toBeGreaterThan(0);
  });
});
