import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";

import {
  SECONDS_PER_UTC_DAY,
  TESTNET_TRADE_POLICY,
  createQuote,
  type Address,
  type AssetDefinition,
  type AssetFreshnessConfig,
  type PolicyContext,
  type PriceBounds,
  type PriceObservation,
  type QuoteRequest,
} from "@kyrox/core";
import { TRADE_ABI } from "@kyrox/protocol";

import { IntentError, prepareTradeIntent, type SepoliaTokenReader } from "../src/intent.js";

const NOW = 1_795_000_000;
const TOKEN: Address = "0x2222222222222222222222222222222222222222";
const OTHER_TOKEN: Address = "0x9999999999999999999999999999999999999999";
const EXCHANGE: Address = "0x1111111111111111111111111111111111111111";
const TRADER: Address = "0x3333333333333333333333333333333333333333";
const FEED: Address = "0x4444444444444444444444444444444444444444";

const asset: AssetDefinition = {
  symbol: "tAAPL",
  name: "Test Apple",
  stockToken: TOKEN,
  stockDecimals: 18,
  priceSourceKind: "chainlink-coinbase",
  listed: true,
};

const observation: PriceObservation = {
  assetSymbol: "tAAPL",
  priceUsdcPerWholeToken: 230_000_000n,
  sourceRoundId: 42n,
  sourceUpdatedAt: NOW - 5,
  observedAt: NOW - 2,
  sourceChainId: 8453,
  feedAddress: FEED,
  sourceKind: "chainlink-coinbase",
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

const freshnessConfig: AssetFreshnessConfig = {
  assetSymbol: "tAAPL",
  maxSourceAgeSeconds: 60,
  requireOpenMarket: true,
};

const priceBounds: PriceBounds = {
  minPriceUsdcPerWholeToken: 1n,
  maxPriceUsdcPerWholeToken: 10n ** 12n,
};

const request: QuoteRequest = {
  assetSymbol: "tAAPL",
  side: "buy",
  amountIn: 1_000_000n,
  maxSlippageBps: 50,
};

const quote = createQuote(request, asset, observation, {
  nowSeconds: NOW,
  chainId: 84_532,
  freshnessConfig,
  session: "open",
  priceBounds,
  quoteTtlSeconds: 60,
});

function reader(chainId = 84_532, decimals = 18, published = canonical): SepoliaTokenReader {
  return {
    getChainId: async () => chainId,
    getTokenDecimals: async () => decimals,
    readObservation: async () => published,
  };
}

function context(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    nowSeconds: NOW,
    utcDay: Math.floor(NOW / SECONDS_PER_UTC_DAY),
    dailySpentUsdc: 0n,
    exchangePaused: false,
    assetEnabled: true,
    session: "open",
    freshness: freshnessConfig,
    priceBounds,
    ...overrides,
  };
}

function params(overrides: Partial<Parameters<typeof prepareTradeIntent>[0]> = {}) {
  return {
    quote,
    observation,
    request,
    asset,
    trader: TRADER,
    exchange: EXCHANGE,
    deadline: NOW + 30,
    nowSeconds: NOW,
    policyConfig: TESTNET_TRADE_POLICY,
    policyContext: context(),
    reader: reader(),
    ...overrides,
  };
}

describe("prepareTradeIntent", () => {
  it("recomputes the quote and encodes the exact exchange call", async () => {
    const intent = await prepareTradeIntent(params());

    expect(intent.chainId).toBe(84_532);
    expect(intent.to).toBe(EXCHANGE);
    expect(intent.value).toBe(0n);
    expect(intent.stockToken).toBe(TOKEN);
    expect(intent.trader).toBe(TRADER);
    expect(intent.minAmountOut).toBe(quote.minAmountOut);
    expect(intent.sourceRoundId).toBe(42n);
    expect(intent.sourceUpdatedAt).toBe(NOW - 5);

    const decoded = decodeFunctionData({ abi: TRADE_ABI, data: intent.data });
    expect(decoded.functionName).toBe("buy");
    expect(decoded.args).toEqual([TOKEN, quote.amountIn, quote.minAmountOut, BigInt(NOW + 30)]);
  });

  it("produces a deterministic intent hash", async () => {
    const a = await prepareTradeIntent(params());
    const b = await prepareTradeIntent(params());
    expect(a.hash).toBe(b.hash);
    expect(a.quoteHash).toBe(b.quoteHash);
    expect(a.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.quoteHash).not.toBe(a.hash);
    expect(a.data).toBe(b.data);
  });

  it("revalidates at a later time inside the quote window", async () => {
    const later = NOW + 10;
    const intent = await prepareTradeIntent(
      params({ nowSeconds: later, policyContext: context({ nowSeconds: later }) }),
    );
    expect(intent.minAmountOut).toBe(quote.minAmountOut);
  });

  it("rejects mismatched on-chain decimals", async () => {
    await expect(prepareTradeIntent(params({ reader: reader(84_532, 6) }))).rejects.toMatchObject({
      code: "DECIMALS_MISMATCH",
    });
  });

  it("rejects a changed or missing token address", async () => {
    await expect(
      prepareTradeIntent(params({ asset: { ...asset, stockToken: OTHER_TOKEN } })),
    ).rejects.toMatchObject({ code: "TOKEN_MISMATCH" });

    await expect(
      prepareTradeIntent(params({ asset: { ...asset, stockToken: null } })),
    ).rejects.toMatchObject({ code: "TOKEN_MISMATCH" });

    await expect(
      prepareTradeIntent(params({ quote: { ...quote, stockToken: OTHER_TOKEN } })),
    ).rejects.toMatchObject({ code: "TOKEN_MISMATCH" });
  });

  it("rejects a wrong chain from either the RPC or the quote", async () => {
    await expect(prepareTradeIntent(params({ reader: reader(8453) }))).rejects.toMatchObject({
      code: "WRONG_CHAIN",
    });
    await expect(
      prepareTradeIntent(params({ quote: { ...quote, chainId: 8453 } })),
    ).rejects.toMatchObject({ code: "WRONG_CHAIN" });
  });

  it("rejects any divergence from the canonical published observation", async () => {
    const divergences = [
      { ...canonical, priceUsdcPerWholeToken: 231_000_000n },
      { ...canonical, sourceRoundId: 43n },
      { ...canonical, sourceUpdatedAt: NOW - 6 },
      { ...canonical, sourceChainId: 84_532 },
      { ...canonical, feedAddress: OTHER_TOKEN },
      { ...canonical, simulated: true },
      { ...canonical, publishedAt: NOW + 1 },
    ];
    for (const published of divergences) {
      await expect(
        prepareTradeIntent(params({ reader: reader(84_532, 18, published) })),
      ).rejects.toMatchObject({ code: "QUOTE_MISMATCH" });
    }
  });

  it("rejects expired quotes and bad deadlines", async () => {
    const expiredAt = quote.expiresAt;
    await expect(
      prepareTradeIntent(
        params({
          nowSeconds: expiredAt,
          policyContext: context({ nowSeconds: expiredAt }),
        }),
      ),
    ).rejects.toMatchObject({ code: "EXPIRED" });

    await expect(
      prepareTradeIntent(params({ deadline: quote.expiresAt + 1 })),
    ).rejects.toMatchObject({ code: "INVALID_DEADLINE" });

    await expect(prepareTradeIntent(params({ deadline: NOW - 1 }))).rejects.toMatchObject({
      code: "EXPIRED",
    });
  });

  it("rejects a changed price observation", async () => {
    await expect(
      prepareTradeIntent(
        params({ observation: { ...observation, priceUsdcPerWholeToken: 240_000_000n } }),
      ),
    ).rejects.toMatchObject({ code: "QUOTE_MISMATCH" });

    await expect(
      prepareTradeIntent(params({ observation: { ...observation, sourceRoundId: 43n } })),
    ).rejects.toMatchObject({ code: "QUOTE_MISMATCH" });
  });

  it("rejects a stale observation instead of trusting the quote", async () => {
    await expect(
      prepareTradeIntent(
        params({
          observation: { ...observation, sourceUpdatedAt: NOW - 120 },
          reader: reader(84_532, 18, { ...canonical, sourceUpdatedAt: NOW - 120 }),
        }),
      ),
    ).rejects.toMatchObject({ code: "STALE_OBSERVATION" });
  });

  it("rejects modified quote fields", async () => {
    await expect(
      prepareTradeIntent(params({ quote: { ...quote, amountOut: quote.amountOut + 1n } })),
    ).rejects.toMatchObject({ code: "QUOTE_MISMATCH" });

    await expect(
      prepareTradeIntent(params({ quote: { ...quote, minAmountOut: quote.amountOut + 1n } })),
    ).rejects.toMatchObject({ code: "QUOTE_MISMATCH" });

    await expect(
      prepareTradeIntent(params({ quote: { ...quote, amountIn: quote.amountIn + 1n } })),
    ).rejects.toMatchObject({ code: "QUOTE_MISMATCH" });
  });

  it("rejects a policy-blocked trade", async () => {
    const error = await prepareTradeIntent(
      params({ policyContext: context({ exchangePaused: true }) }),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IntentError);
    expect(error).toMatchObject({ code: "POLICY_REJECTED" });
    expect((error as IntentError).details).toContain("EXCHANGE_PAUSED");
  });

  it("rejects an intent whose policy clock disagrees with its timestamp", async () => {
    await expect(
      prepareTradeIntent(params({ policyContext: context({ nowSeconds: NOW - 1 }) })),
    ).rejects.toMatchObject({ code: "QUOTE_MISMATCH" });
  });

  it("has no signing or submission path in its source", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/intent.ts", import.meta.url)),
      "utf8",
    );
    for (const forbidden of [
      "signTransaction",
      "sendTransaction",
      "sendRawTransaction",
      "writeContract",
      "privateKey",
      "walletClient",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
