import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DemoQuoteError,
  createDemoQuote,
  demoDailyRemaining,
  demoNotional,
  demoQuoteNotional,
  executeDemoQuote,
} from "../lib/demo/quote.js";
import {
  defaultDemoLedger,
  seal,
  unseal,
  type DemoFill,
  type DemoSession,
} from "../lib/demo/session.js";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222" as const;
const NOW = 1_800_000_000;

function session(activity: DemoFill[] = []): DemoSession {
  return {
    address: ADDRESS,
    expiresAt: NOW + 3_600,
    demo: true,
    ledger: { balances: defaultDemoLedger().balances, activity },
  };
}

function retoken(token: string, changes: Record<string, unknown>): string {
  const stored = unseal<Record<string, unknown>>(token);
  if (stored === null) throw new Error("Expected a valid demo quote token");
  return seal({ ...stored, ...changes });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("demo quote lifecycle", () => {
  it("issues a signed, deterministic quote with base-unit fields and display labels", () => {
    vi.stubEnv("KYROX_DEMO_SECRET", "demo-secret-for-tests-0123456789abcdef");
    const quote = createDemoQuote({
      session: session(),
      symbol: "tAAPL",
      side: "buy",
      amountIn: 10_000_000n,
      slippageBps: 50,
      now: NOW,
    });
    expect(quote).toMatchObject({
      symbol: "tAAPL",
      side: "buy",
      amountIn: "10000000",
      amountInLabel: "10",
      simulated: true,
      simulatedPrice: true,
      expiresAt: NOW + 30,
      ttlSeconds: 30,
      limits: { minUsdc: "1", maxUsdc: "1000", dailyUsdc: "5000" },
    });
    expect(BigInt(quote.amountOut)).toBeGreaterThan(0n);
    expect(BigInt(quote.minAmountOut)).toBeLessThan(BigInt(quote.amountOut));
    expect(unseal<{ q: string; a: string }>(quote.quoteToken)).toMatchObject({
      q: quote.quoteId,
      a: ADDRESS,
    });
    expect(demoQuoteNotional(quote)).toBe(10_000_000n);
  });

  it("executes once and updates the ledger with the current reference output", () => {
    vi.stubEnv("KYROX_DEMO_SECRET", "demo-secret-for-tests-0123456789abcdef");
    const original = session();
    const quote = createDemoQuote({
      session: original,
      symbol: "tAAPL",
      side: "buy",
      amountIn: 10_000_000n,
      slippageBps: 50,
      now: NOW,
    });
    const result = executeDemoQuote({
      session: original,
      quoteId: quote.quoteId,
      quoteToken: quote.quoteToken,
      now: NOW + 1,
    });
    expect(result.fill).toMatchObject({ symbol: "tAAPL", side: "buy", amountIn: "10000000" });
    expect(result.session.ledger.activity).toHaveLength(1);
    expect(original.ledger.activity).toHaveLength(0);
    expect(result.session.ledger.balances.tUSDC).toBe("24990000000");
  });

  it("rejects replay of an already executed quote", () => {
    vi.stubEnv("KYROX_DEMO_SECRET", "demo-secret-for-tests-0123456789abcdef");
    const quote = createDemoQuote({
      session: session(),
      symbol: "tAAPL",
      side: "buy",
      amountIn: 10_000_000n,
      slippageBps: 50,
      now: NOW,
    });
    const first = executeDemoQuote({
      session: session(),
      quoteId: quote.quoteId,
      quoteToken: quote.quoteToken,
      now: NOW + 1,
    });
    expect(() =>
      executeDemoQuote({
        session: first.session,
        quoteId: quote.quoteId,
        quoteToken: quote.quoteToken,
        now: NOW + 2,
      }),
    ).toThrowError(expect.objectContaining({ code: "quote_replayed", status: 409 }));
  });

  it("rejects tampered tokens, mismatched ids, another account, and expiry", () => {
    vi.stubEnv("KYROX_DEMO_SECRET", "demo-secret-for-tests-0123456789abcdef");
    const quote = createDemoQuote({
      session: session(),
      symbol: "tAAPL",
      side: "buy",
      amountIn: 10_000_000n,
      slippageBps: 50,
      now: NOW,
    });
    const execute = (overrides: Partial<Parameters<typeof executeDemoQuote>[0]>) =>
      executeDemoQuote({
        session: session(),
        quoteId: quote.quoteId,
        quoteToken: quote.quoteToken,
        now: NOW + 1,
        ...overrides,
      });

    expect(() => execute({ quoteToken: `${quote.quoteToken}00` })).toThrowError(
      expect.objectContaining({ code: "invalid_quote" }),
    );
    expect(() => execute({ quoteId: "other" })).toThrowError(
      expect.objectContaining({ code: "invalid_quote" }),
    );
    expect(() => execute({ session: { ...session(), address: OTHER_ADDRESS } })).toThrowError(
      expect.objectContaining({ code: "invalid_quote", status: 403 }),
    );
    expect(() => execute({ now: NOW + 30 })).toThrowError(
      expect.objectContaining({ code: "quote_expired" }),
    );
  });

  it("fails closed when the reference price moves or the minimum output is tampered", () => {
    vi.stubEnv("KYROX_DEMO_SECRET", "demo-secret-for-tests-0123456789abcdef");
    const quote = createDemoQuote({
      session: session(),
      symbol: "tAAPL",
      side: "buy",
      amountIn: 10_000_000n,
      slippageBps: 50,
      now: NOW,
    });
    expect(() =>
      executeDemoQuote({
        session: session(),
        quoteId: quote.quoteId,
        quoteToken: retoken(quote.quoteToken, { p: "1" }),
        now: NOW + 1,
      }),
    ).toThrowError(expect.objectContaining({ code: "price_moved" }));
    expect(() =>
      executeDemoQuote({
        session: session(),
        quoteId: quote.quoteId,
        quoteToken: retoken(quote.quoteToken, { min: (2n ** 256n - 1n).toString() }),
        now: NOW + 1,
      }),
    ).toThrowError(expect.objectContaining({ code: "slippage_exceeded" }));
  });

  it("rejects unsupported assets and insufficient balances", () => {
    vi.stubEnv("KYROX_DEMO_SECRET", "demo-secret-for-tests-0123456789abcdef");
    expect(() =>
      createDemoQuote({
        session: session(),
        symbol: "tDOGE",
        side: "buy",
        amountIn: 10_000_000n,
        slippageBps: 50,
        now: NOW,
      }),
    ).toThrowError(expect.objectContaining({ code: "unsupported_asset", status: 404 }));
    const initial = session();
    const lowBalance: DemoSession = {
      ...initial,
      ledger: {
        ...initial.ledger,
        balances: { ...initial.ledger.balances, tUSDC: "1000000" },
      },
    };
    expect(() =>
      createDemoQuote({
        session: lowBalance,
        symbol: "tAAPL",
        side: "buy",
        amountIn: 2_000_000n,
        slippageBps: 50,
        now: NOW,
      }),
    ).toThrowError(expect.objectContaining({ code: "insufficient_balance" }));
  });
});

describe("demo daily accounting", () => {
  it("derives remaining allowance from same-day buys and never returns a negative value", () => {
    const activity: DemoFill[] = [
      {
        id: "today",
        symbol: "tAAPL",
        side: "buy",
        amountIn: "4999500000",
        amountOut: "1",
        priceUsdc: "300000000",
        createdAt: new Date(NOW * 1_000).toISOString(),
        reference: "sim_today",
      },
    ];
    expect(demoDailyRemaining(session(activity), NOW)).toBe(500_000n);
    expect(demoDailyRemaining(session([{ ...activity[0]!, amountIn: "6000000000" }]), NOW)).toBe(
      0n,
    );
    expect(demoNotional("buy", 1_000_000n, 2n)).toBe(1_000_000n);
    expect(demoNotional("sell", 2n, 1_000_000n)).toBe(1_000_000n);
  });

  it("uses the typed demo error for policy and balance rejections", () => {
    expect(new DemoQuoteError("policy", "rejected")).toMatchObject({
      name: "DemoQuoteError",
      code: "policy",
      status: 400,
    });
  });
});
