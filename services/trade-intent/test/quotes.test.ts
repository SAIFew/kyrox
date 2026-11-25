import { describe, expect, it } from "vitest";

import {
  TESTNET_TRADE_POLICY,
  type Address,
  type AssetDefinition,
  type AssetFreshnessConfig,
  type PriceBounds,
} from "@kyrox/core";

import { IntentError } from "../src/intent.js";
import {
  InMemoryIssuedQuoteStore,
  QuoteService,
  QuoteServiceError,
  type TrustedPolicySource,
} from "../src/quotes.js";

const NOW = 1_795_000_000;
const TOKEN = "0x2222222222222222222222222222222222222222" as Address;
const EXCHANGE = "0x1111111111111111111111111111111111111111" as Address;
const TRADER = "0x3333333333333333333333333333333333333333" as Address;
const OTHER = "0x9999999999999999999999999999999999999999" as Address;
const FEED = "0x4444444444444444444444444444444444444444" as Address;

const asset: AssetDefinition = {
  symbol: "tAAPL",
  name: "Test Apple",
  stockToken: TOKEN,
  stockDecimals: 18,
  priceSourceKind: "chainlink-coinbase",
  listed: true,
};

const observation = {
  assetSymbol: "tAAPL",
  priceUsdcPerWholeToken: 230_000_000n,
  sourceRoundId: 42n,
  sourceUpdatedAt: NOW - 5,
  observedAt: NOW - 2,
  sourceChainId: 8_453,
  feedAddress: FEED,
  sourceKind: "chainlink-coinbase" as const,
};

const canonical = {
  priceUsdcPerWholeToken: observation.priceUsdcPerWholeToken,
  sourceRoundId: observation.sourceRoundId,
  sourceUpdatedAt: observation.sourceUpdatedAt,
  publishedAt: NOW,
  sourceChainId: observation.sourceChainId,
  feedAddress: FEED,
  simulated: false,
};

const freshness: AssetFreshnessConfig = {
  assetSymbol: "tAAPL",
  maxSourceAgeSeconds: 60,
  requireOpenMarket: true,
};
const bounds: PriceBounds = {
  minPriceUsdcPerWholeToken: 1n,
  maxPriceUsdcPerWholeToken: 10n ** 12n,
};

class FakePolicy implements TrustedPolicySource {
  now = NOW;
  paused = false;
  enabled = true;
  spent = 0n;
  nowSeconds(): number {
    return this.now;
  }
  async dailySpentUsdc(): Promise<bigint> {
    return this.spent;
  }
  async isExchangePaused(): Promise<boolean> {
    return this.paused;
  }
  async isAssetEnabled(): Promise<boolean> {
    return this.enabled;
  }
  async marketSession(): Promise<"open"> {
    return "open";
  }
  freshnessFor(): AssetFreshnessConfig {
    return freshness;
  }
  priceBoundsFor(): PriceBounds {
    return bounds;
  }
}

function service(
  policy: FakePolicy,
  ttl = 60,
  tradeReader: typeof reader = reader,
  exchange: Address = EXCHANGE,
): QuoteService {
  return new QuoteService({
    secret: "a".repeat(48),
    store: new InMemoryIssuedQuoteStore(),
    policy,
    policyConfig: TESTNET_TRADE_POLICY,
    exchange,
    reader: tradeReader,
    maxTtlSeconds: ttl,
  });
}

const reader = {
  getChainId: async () => 84_532,
  getTokenDecimals: async () => 18,
  readObservation: async () => canonical,
};

async function issued(policy: FakePolicy) {
  const quoteService = service(policy);
  const result = await quoteService.issueQuote({
    session: { trader: TRADER },
    asset,
    observation,
    side: "buy",
    amountIn: 1_000_000n,
    maxSlippageBps: 50,
  });
  return { quoteService, result };
}

const prepareParams = {
  quoteId: "",
  quoteToken: "",
  asset,
  exchange: EXCHANGE,
  deadline: NOW + 30,
  reader,
};

describe("server-issued quote boundary", () => {
  it("issues a server-expiring quote and prepares an intent", async () => {
    const policy = new FakePolicy();
    const { quoteService, result } = await issued(policy);
    expect(result.expiresAt).toBe(NOW + 60);
    expect(result.ttlSeconds).toBe(60);

    const intent = await quoteService.prepareIntent({
      ...prepareParams,
      session: { trader: TRADER },
      quoteId: result.quoteId,
      quoteToken: result.quoteToken,
    });
    expect(intent.quoteId).toBe(result.quoteId);
    expect(intent.hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("rejects a different trader wallet and missing authentication", async () => {
    const policy = new FakePolicy();
    const { quoteService, result } = await issued(policy);
    await expect(
      quoteService.prepareIntent({
        ...prepareParams,
        session: { trader: OTHER },
        quoteId: result.quoteId,
        quoteToken: result.quoteToken,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    await expect(
      quoteService.prepareIntent({
        ...prepareParams,
        session: null,
        quoteId: result.quoteId,
        quoteToken: result.quoteToken,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("rejects a modified quote or tampered token", async () => {
    const policy = new FakePolicy();
    const { quoteService, result } = await issued(policy);
    await expect(
      quoteService.prepareIntent({
        ...prepareParams,
        session: { trader: TRADER },
        quoteId: result.quoteId,
        quoteToken: `${result.quoteToken}00`,
      }),
    ).rejects.toMatchObject({ code: "QUOTE_TOKEN_INVALID" });

    const store = new InMemoryIssuedQuoteStore();
    const service2 = new QuoteService({
      secret: "a".repeat(48),
      store,
      policy,
      policyConfig: TESTNET_TRADE_POLICY,
      exchange: EXCHANGE,
      reader,
      maxTtlSeconds: 60,
    });
    const issued2 = await service2.issueQuote({
      session: { trader: TRADER },
      asset,
      observation,
      side: "buy",
      amountIn: 1_000_000n,
      maxSlippageBps: 50,
    });
    const record = await store.get(issued2.quoteId);
    if (record !== null) {
      (record.quote as { expiresAt: number }).expiresAt = NOW + 86_400;
    }
    await expect(
      service2.prepareIntent({
        ...prepareParams,
        session: { trader: TRADER },
        quoteId: issued2.quoteId,
        quoteToken: issued2.quoteToken,
      }),
    ).rejects.toBeInstanceOf(QuoteServiceError);
  });

  it("rejects expired and replayed quotes", async () => {
    const policy = new FakePolicy();
    const { quoteService, result } = await issued(policy);
    policy.now = NOW + 60;
    await expect(
      quoteService.prepareIntent({
        ...prepareParams,
        session: { trader: TRADER },
        quoteId: result.quoteId,
        quoteToken: result.quoteToken,
      }),
    ).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });

    const policy2 = new FakePolicy();
    const second = await issued(policy2);
    await second.quoteService.prepareIntent({
      ...prepareParams,
      session: { trader: TRADER },
      quoteId: second.result.quoteId,
      quoteToken: second.result.quoteToken,
    });
    await expect(
      second.quoteService.prepareIntent({
        ...prepareParams,
        session: { trader: TRADER },
        quoteId: second.result.quoteId,
        quoteToken: second.result.quoteToken,
      }),
    ).rejects.toMatchObject({ code: "QUOTE_REPLAYED" });
  });

  it("uses trusted pause, daily spend and freshness, never caller values", async () => {
    const paused = new FakePolicy();
    paused.paused = true;
    const p = await issued(paused);
    await expect(
      p.quoteService.prepareIntent({
        ...prepareParams,
        session: { trader: TRADER },
        quoteId: p.result.quoteId,
        quoteToken: p.result.quoteToken,
      }),
    ).rejects.toMatchObject({ code: "POLICY_REJECTED" });

    const spent = new FakePolicy();
    spent.spent = 5_000_000_000n;
    const s = await issued(spent);
    await expect(
      s.quoteService.prepareIntent({
        ...prepareParams,
        session: { trader: TRADER },
        quoteId: s.result.quoteId,
        quoteToken: s.result.quoteToken,
      }),
    ).rejects.toMatchObject({ code: "POLICY_REJECTED" });

    const stale = new FakePolicy();
    const st = await issued(stale);
    stale.now = NOW + 45;
    await expect(
      st.quoteService.prepareIntent({
        ...prepareParams,
        session: { trader: TRADER },
        quoteId: st.result.quoteId,
        quoteToken: st.result.quoteToken,
        deadline: NOW + 30,
      }),
    ).rejects.toBeInstanceOf(IntentError);
  });

  it("fails closed on RPC chain, decimals, or canonical observation divergence", async () => {
    const policy = new FakePolicy();
    await expect(
      service(policy, 60, { ...reader, getChainId: async () => 8_453 }).issueQuote({
        session: { trader: TRADER },
        asset,
        observation,
        side: "buy",
        amountIn: 1_000_000n,
        maxSlippageBps: 50,
      }),
    ).rejects.toMatchObject({ code: "WRONG_CHAIN" });

    await expect(
      service(policy, 60, { ...reader, getTokenDecimals: async () => 6 }).issueQuote({
        session: { trader: TRADER },
        asset,
        observation,
        side: "buy",
        amountIn: 1_000_000n,
        maxSlippageBps: 50,
      }),
    ).rejects.toMatchObject({ code: "DECIMALS_MISMATCH" });

    await expect(
      service(policy, 60, {
        ...reader,
        readObservation: async () => ({ ...canonical, priceUsdcPerWholeToken: 231_000_000n }),
      }).issueQuote({
        session: { trader: TRADER },
        asset,
        observation,
        side: "buy",
        amountIn: 1_000_000n,
        maxSlippageBps: 50,
      }),
    ).rejects.toMatchObject({ code: "QUOTE_MISMATCH" });
  });

  it("rechecks the canonical observation during intent preparation", async () => {
    const policy = new FakePolicy();
    const { quoteService, result } = await issued(policy);
    await expect(
      quoteService.prepareIntent({
        ...prepareParams,
        session: { trader: TRADER },
        quoteId: result.quoteId,
        quoteToken: result.quoteToken,
        reader: {
          ...reader,
          readObservation: async () => ({ ...canonical, simulated: true }),
        },
      }),
    ).rejects.toMatchObject({ code: "QUOTE_MISMATCH" });
  });

  it("caps TTL server-side and rejects an excessive configuration", async () => {
    const policy = new FakePolicy();
    const { result } = await issued(policy);
    expect(result.expiresAt - NOW).toBe(60);
    expect(() => service(policy, 301)).toThrow(QuoteServiceError);
    expect(() => service(policy, 0)).toThrow(QuoteServiceError);
  });
});
