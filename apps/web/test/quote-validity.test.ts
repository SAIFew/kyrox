import { describe, expect, it } from "vitest";

import {
  DEFAULT_QUOTE_TTL_SECONDS,
  TESTNET_TRADE_POLICY,
  type Address,
  type AssetDefinition,
  type AssetFreshnessConfig,
  type MarketSession,
  type PriceBounds,
  type PriceObservation,
} from "@kyrox/core";
import {
  InMemoryIssuedQuoteStore,
  QuoteService,
  type TrustedPolicySource,
} from "@kyrox/trade-intent";

import { createDemoQuote } from "../lib/demo/quote.js";
import { defaultDemoLedger, type DemoSession } from "../lib/demo/session.js";

const NOW = 1_800_000_000;
const ADDRESS = "0x1111111111111111111111111111111111111111" as Address;
const TOKEN = "0x2222222222222222222222222222222222222222" as Address;
const EXCHANGE = "0x3333333333333333333333333333333333333333" as Address;
const ZERO_FEED = "0x0000000000000000000000000000000000000000" as Address;

const asset: AssetDefinition = {
  symbol: "tAAPL",
  name: "Test Apple",
  stockToken: TOKEN,
  stockDecimals: 18,
  priceSourceKind: "simulated",
  listed: true,
};

const observation: PriceObservation = {
  assetSymbol: "tAAPL",
  priceUsdcPerWholeToken: 250_000_000n,
  sourceRoundId: 7n,
  sourceUpdatedAt: NOW - 5,
  observedAt: NOW - 2,
  sourceChainId: 8_453,
  feedAddress: null,
  sourceKind: "simulated",
};

const freshness: AssetFreshnessConfig = {
  assetSymbol: "tAAPL",
  maxSourceAgeSeconds: 600,
  requireOpenMarket: false,
};
const bounds: PriceBounds = {
  minPriceUsdcPerWholeToken: 1n,
  maxPriceUsdcPerWholeToken: 10n ** 12n,
};

class FakePolicy implements TrustedPolicySource {
  nowSeconds(): number {
    return NOW;
  }
  async dailySpentUsdc(): Promise<bigint> {
    return 0n;
  }
  async isExchangePaused(): Promise<boolean> {
    return false;
  }
  async isAssetEnabled(): Promise<boolean> {
    return true;
  }
  async marketSession(): Promise<MarketSession> {
    return "open";
  }
  freshnessFor(): AssetFreshnessConfig {
    return freshness;
  }
  priceBoundsFor(): PriceBounds {
    return bounds;
  }
}

function demoSession(): DemoSession {
  return {
    address: ADDRESS,
    expiresAt: NOW + 3_600,
    demo: true,
    ledger: defaultDemoLedger(),
  };
}

describe("30-second quote validity", () => {
  it("uses a 30-second core default", () => {
    expect(DEFAULT_QUOTE_TTL_SECONDS).toBe(30);
  });

  it("expires demo quotes after 30 seconds", () => {
    const quote = createDemoQuote({
      session: demoSession(),
      symbol: "tAAPL",
      side: "buy",
      amountIn: 10_000_000n,
      slippageBps: 50,
      now: NOW,
    });
    expect(quote.ttlSeconds).toBe(30);
    expect(quote.expiresAt).toBe(NOW + 30);
  });

  it("uses 30 seconds when QuoteService is not given an explicit max TTL", async () => {
    const service = new QuoteService({
      secret: "a".repeat(48),
      store: new InMemoryIssuedQuoteStore(),
      policy: new FakePolicy(),
      policyConfig: TESTNET_TRADE_POLICY,
      exchange: EXCHANGE,
      reader: {
        getChainId: async () => 84_532,
        getTokenDecimals: async () => 18,
        readObservation: async () => ({
          priceUsdcPerWholeToken: observation.priceUsdcPerWholeToken,
          sourceRoundId: observation.sourceRoundId,
          sourceUpdatedAt: observation.sourceUpdatedAt,
          publishedAt: NOW,
          sourceChainId: observation.sourceChainId,
          feedAddress: ZERO_FEED,
          simulated: true,
        }),
      },
    });

    const result = await service.issueQuote({
      session: { trader: ADDRESS },
      asset,
      observation,
      side: "buy",
      amountIn: 1_000_000n,
      maxSlippageBps: 50,
    });
    expect(result.ttlSeconds).toBe(30);
    expect(result.expiresAt).toBe(NOW + 30);
  });
});
