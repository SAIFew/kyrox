import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "../lib/api.js";
import { createDemoQuote } from "../lib/demo/quote.js";
import { demoDetail, demoMarketList } from "../lib/demo/market.js";
import {
  applyFill,
  defaultDemoLedger,
  demoActivity,
  demoPortfolio,
  type DemoSession,
} from "../lib/demo/session.js";
import type {
  ActivityItem,
  MarketDetail,
  MarketSnapshot,
  PortfolioPayload,
  QuotePayload,
} from "../lib/market-types.js";

const NOW = 1_800_000_000;
const ADDRESS = "0x1111111111111111111111111111111111111111" as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API client response handling", () => {
  it("returns the current nested quote response without flattening it", async () => {
    const payload = { quote: { quoteId: "quote-1", quoteToken: "signed" } };
    const fetchMock = vi.fn(async () => Response.json(payload));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      api<typeof payload>("/api/quotes", { method: "POST", body: "{}" }),
    ).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/quotes",
      expect.objectContaining({
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("maps JSON failures to a typed API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "Quote expired.", code: "quote_expired" }, { status: 410 }),
      ),
    );
    const failure = api("/api/quotes").catch((error: unknown) => error);
    await expect(failure).resolves.toBeInstanceOf(ApiError);
    await expect(failure).resolves.toMatchObject({
      message: "Quote expired.",
      status: 410,
      code: "quote_expired",
    });
  });

  it("uses a stable fallback for non-JSON failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream down", { status: 502 })),
    );
    await expect(api("/api/markets").catch((error: unknown) => error)).resolves.toMatchObject({
      message: "Request failed (502).",
      status: 502,
      code: "request_failed",
    });
  });
});

describe("demo API payload shapes", () => {
  it("marks every market, detail, quote, portfolio, and activity payload as simulated", () => {
    const markets = demoMarketList(NOW);
    expect(markets.map((row) => row.asset.symbol)).toEqual([
      "tAAPL",
      "tNVDA",
      "tMSFT",
      "tGOOGL",
      "tAMZN",
      "tTSLA",
      "tMETA",
    ]);
    const snapshots: MarketSnapshot[] = markets.map((row) => row.snapshot);
    expect(snapshots.every((snapshot) => snapshot.simulated && snapshot.fresh)).toBe(true);
    expect(markets.every((row) => row.sparkline.length >= 2)).toBe(true);

    const detail = demoDetail("tAAPL", "1M", NOW) as MarketDetail;
    expect(detail).toMatchObject({ symbol: "tAAPL", range: "1M", simulated: true });
    expect(detail.history.length).toBeGreaterThan(2);
    expect(detail.history.every((point) => Number.isFinite(point.p) && point.t <= NOW)).toBe(true);

    const session: DemoSession = {
      address: ADDRESS,
      expiresAt: NOW + 3_600,
      demo: true,
      ledger: defaultDemoLedger(),
    };
    const quote = createDemoQuote({
      session,
      symbol: "tAAPL",
      side: "buy",
      amountIn: 1_000_000n,
      slippageBps: 50,
      now: NOW,
    }) satisfies QuotePayload;
    expect(quote.simulated).toBe(true);
    expect(quote.simulatedPrice).toBe(true);
    expect(quote.ttlSeconds).toBe(30);
    expect(quote.limits.remainingUsdc).toBe("5000");

    const filled = applyFill(session, {
      symbol: "tAAPL",
      side: "buy",
      amountIn: quote.amountIn,
      amountOut: quote.amountOut,
      priceUsdc: "300000000",
    }).session;
    const portfolio = demoPortfolio(filled, NOW) satisfies PortfolioPayload;
    expect(portfolio).toMatchObject({ mode: "demo", simulated: true, stale: false });
    expect(portfolio.positions).toHaveLength(7);
    expect(portfolio.cash.amount).toBe("24999");

    const activity = demoActivity(filled) satisfies ActivityItem[];
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ status: "simulated", simulated: true, txHash: null });
  });
});
