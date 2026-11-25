import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEMO_SESSION_TTL_SECONDS,
  applyFill,
  balanceOf,
  decodeDemoSession,
  dailySpentUsdc,
  defaultDemoGrowth,
  defaultDemoLedger,
  demoActivity,
  demoSecret,
  encodeDemoSession,
  isDemoQuoteConsumed,
  isHighEntropyDemoSecret,
  seal,
  unseal,
  withTrustedAddress,
  type DemoFill,
  type DemoLedger,
  type DemoSession,
} from "../lib/demo/session.js";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222" as const;

function session(ledger: DemoLedger = defaultDemoLedger()): DemoSession {
  return {
    address: ADDRESS,
    expiresAt: Math.floor(Date.now() / 1_000) + DEMO_SESSION_TTL_SECONDS,
    demo: true,
    ledger,
    growth: defaultDemoGrowth(),
  };
}

function fill(overrides: Partial<DemoFill> = {}): DemoFill {
  return {
    id: "fill-1",
    symbol: "tAAPL",
    side: "buy",
    amountIn: "1000000",
    amountOut: "3000000000000000000",
    priceUsdc: "300000000",
    createdAt: "2026-11-24T12:00:00.000Z",
    reference: "sim_test",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("demo session integrity", () => {
  it("round-trips a sealed session and rejects tampering", () => {
    vi.stubEnv("KYROX_DEMO_SECRET", "demo-secret-for-tests-0123456789abcdef");
    const original = session();
    const token = encodeDemoSession(original);
    expect(decodeDemoSession(token)).toEqual(original);

    const [body, signature] = token.split(".");
    expect(body).toBeDefined();
    expect(signature).toBeDefined();
    const changed = `${signature?.[0] === "a" ? "b" : "a"}${signature?.slice(1)}`;
    expect(unseal(`${body}.${changed}`)).toBeNull();
    expect(decodeDemoSession(`${token}00`)).toBeNull();
    expect(decodeDemoSession(undefined)).toBeNull();
  });

  it("requires a high-entropy secret and never invents one in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KYROX_DEMO_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => demoSecret()).toThrow(/required in production/);
    vi.stubEnv("AUTH_SECRET", "a".repeat(48));
    expect(() => demoSecret()).toThrow(/high-entropy/);
    vi.stubEnv("AUTH_SECRET", "demo-secret-for-tests-0123456789abcdef");
    expect(isHighEntropyDemoSecret(demoSecret())).toBe(true);
  });

  it("rejects expired sessions and invalid addresses", () => {
    vi.stubEnv("KYROX_DEMO_SECRET", "demo-secret-for-tests-0123456789abcdef");
    const expired = session();
    const token = encodeDemoSession({ ...expired, expiresAt: 1 });
    expect(decodeDemoSession(token)).toBeNull();
    expect(
      decodeDemoSession(encodeDemoSession({ ...expired, address: "0x1234" as `0x${string}` })),
    ).toBeNull();
  });

  it("sanitizes decoded balances and activity without trusting cookie contents", () => {
    vi.stubEnv("KYROX_DEMO_SECRET", "demo-secret-for-tests-0123456789abcdef");
    const fallback = defaultDemoLedger();
    const token = seal({
      v: 2,
      a: ADDRESS,
      exp: Math.floor(Date.now() / 1_000) + 3_600,
      b: { tUSDC: "-1", tAAPL: "not-a-number", tTSLA: "42", tDOGE: "999" },
      d: {
        [String(Math.floor(Date.parse("2026-11-24T12:00:00.000Z") / 86_400_000))]: "7000000000",
      },
      c: {
        active: Math.floor(Date.now() / 1_000) + 300,
        expired: Math.floor(Date.now() / 1_000) - 1,
      },
      h: [
        fill(),
        fill({ id: "unknown", symbol: "tDOGE" }),
        fill({ id: "bad-side", side: "hold" as "buy" }),
        ...Array.from({ length: 15 }, (_, index) => fill({ id: `extra-${index}` })),
      ],
    });
    const decoded = decodeDemoSession(token);
    expect(decoded?.ledger.balances).toEqual({
      tUSDC: "0",
      tAAPL: "0",
      tNVDA: fallback.balances.tNVDA,
      tMSFT: fallback.balances.tMSFT,
      tGOOGL: fallback.balances.tGOOGL,
      tAMZN: fallback.balances.tAMZN,
      tTSLA: "42",
      tMETA: fallback.balances.tMETA,
    });
    expect(decoded?.ledger.activity).toHaveLength(10);
    expect(decoded?.ledger.activity.every((entry) => entry.symbol !== "tDOGE")).toBe(true);
    expect(Object.keys(decoded?.ledger.consumedQuoteIds ?? {})).toEqual(["active"]);
    expect(
      decoded?.ledger.dailyNotionalUsdc?.[
        String(Math.floor(Date.parse("2026-11-24T12:00:00.000Z") / 86_400_000))
      ],
    ).toBe("7000000000");
  });

  it("binds a preview ledger to a verified address without mutating the original", () => {
    const original = session();
    const bound = withTrustedAddress(original, OTHER_ADDRESS);
    expect(bound.address).toBe(OTHER_ADDRESS);
    expect(bound.ledger).toBe(original.ledger);
    expect(original.address).toBe(ADDRESS);
    expect(bound.expiresAt).toBeGreaterThanOrEqual(original.expiresAt);
  });
});

describe("demo accounting", () => {
  it("applies immutable buy and sell fills with exact integer balances", () => {
    const original = session();
    const bought = applyFill(original, {
      symbol: "tAAPL",
      side: "buy",
      amountIn: "1000000",
      amountOut: "3000000000000000000",
      priceUsdc: "300000000",
    });
    expect(balanceOf(bought.session, "tUSDC")).toBe(24_999_000_000n);
    expect(balanceOf(bought.session, "tAAPL")).toBe(15_500_000_000_000_000_000n);
    expect(balanceOf(original, "tUSDC")).toBe(25_000_000_000n);
    expect(original.ledger.activity).toHaveLength(0);
    expect(bought.fill.reference).toMatch(/^sim_[a-f0-9]{12}$/);

    const sold = applyFill(bought.session, {
      symbol: "tAAPL",
      side: "sell",
      amountIn: "1000000000000000000",
      amountOut: "300000000",
      priceUsdc: "300000000",
    });
    expect(balanceOf(sold.session, "tAAPL")).toBe(14_500_000_000_000_000_000n);
    expect(balanceOf(sold.session, "tUSDC")).toBe(25_299_000_000n);
    expect(sold.session.ledger.activity[0]?.side).toBe("sell");
  });

  it("counts same-UTC-day buy input and sell output toward the daily notional", () => {
    const ledger: DemoLedger = {
      balances: defaultDemoLedger().balances,
      activity: [
        fill({ id: "today", amountIn: "1000000000" }),
        fill({ id: "today-second", amountIn: "2000000000" }),
        fill({ id: "yesterday", amountIn: "999000000", createdAt: "2026-11-23T23:59:59.999Z" }),
        fill({
          id: "sell",
          side: "sell",
          amountIn: "500000000",
          amountOut: "1500000000",
        }),
        fill({ id: "malformed", amountIn: "oops" }),
      ],
    };
    const now = Date.parse("2026-11-24T23:59:59.999Z");
    expect(dailySpentUsdc(session(ledger), now)).toBe(4_500_000_000n);
    expect(dailySpentUsdc(session(ledger), Date.parse("2026-11-25T00:00:00.000Z"))).toBe(0n);
  });

  it("keeps only the newest twelve fills while preserving untruncated daily accounting", () => {
    let current = session();
    const nowMs = Date.parse("2026-11-24T12:00:00.000Z");
    for (let index = 0; index < 15; index += 1) {
      current = applyFill(
        current,
        {
          symbol: "tAAPL",
          side: "buy",
          amountIn: "1000000",
          amountOut: "1",
          priceUsdc: "300000000",
        },
        {
          nowMs,
          consumedQuoteId: `quote-${index}`,
          quoteExpiresAt: nowMs / 1_000 + 120,
        },
      ).session;
    }
    expect(current.ledger.activity).toHaveLength(12);
    expect(current.ledger.dailyNotionalUsdc?.[String(Math.floor(nowMs / 86_400_000))]).toBe(
      "15000000",
    );
    expect(Object.keys(current.ledger.consumedQuoteIds ?? {})).toHaveLength(15);
    expect(isDemoQuoteConsumed(current, "quote-0", nowMs / 1_000)).toBe(true);
    const activity = demoActivity(current);
    expect(activity).toHaveLength(12);
    expect(activity[0]).toMatchObject({
      status: "simulated",
      txHash: null,
      simulated: true,
      priceUsdc: "300",
    });
  });
});
