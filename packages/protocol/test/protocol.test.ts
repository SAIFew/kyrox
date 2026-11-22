import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";

import {
  SET_PRICE_ABI,
  TRADE_ABI,
  DeploymentError,
  encodeSetPrice,
  encodeTrade,
  hashQuote,
  hashTradeIntent,
  parseDeploymentManifest,
  requireExchangeAddress,
} from "../src/index.js";

const EXCHANGE = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;
const TRADER = "0x3333333333333333333333333333333333333333" as const;
const FEED = "0x4444444444444444444444444444444444444444" as const;

describe("deployment manifests", () => {
  it("accepts a Base Sepolia manifest and resolves the exchange", () => {
    const manifest = parseDeploymentManifest({
      chainId: 84_532,
      chain: "base-sepolia",
      status: "deployed",
      contracts: { KyroxExchange: { address: EXCHANGE, verified: true } },
    });
    expect(requireExchangeAddress(manifest)).toBe(EXCHANGE);
  });

  it("rejects any other chain id", () => {
    expect(() =>
      parseDeploymentManifest({ chainId: 8453, chain: "base", status: "x", contracts: {} }),
    ).toThrow(DeploymentError);
  });

  it("rejects zero and malformed addresses", () => {
    expect(() =>
      parseDeploymentManifest({
        chainId: 84_532,
        chain: "base-sepolia",
        status: "x",
        contracts: { KyroxExchange: { address: "0x0000000000000000000000000000000000000000" } },
      }),
    ).toThrow(DeploymentError);
    expect(() =>
      parseDeploymentManifest({
        chainId: 84_532,
        chain: "base-sepolia",
        status: "x",
        contracts: { KyroxExchange: { address: "0x1234" } },
      }),
    ).toThrow(DeploymentError);
  });

  it("fails closed when the exchange is missing", () => {
    const manifest = parseDeploymentManifest({
      chainId: 84_532,
      chain: "base-sepolia",
      status: "unpopulated",
      contracts: {},
    });
    expect(() => requireExchangeAddress(manifest)).toThrow(DeploymentError);
  });
});

describe("calldata encoding", () => {
  it("encodes setPrice with the exact contract signature", () => {
    const tx = encodeSetPrice(EXCHANGE, {
      stockToken: TOKEN,
      priceUsdcPerWholeToken: 345_297_696n,
      sourceRoundId: 42n,
      sourceUpdatedAt: 1_795_000_000,
      sourceChainId: 8453,
      feedAddress: FEED,
      simulated: false,
    });
    expect(tx.to).toBe(EXCHANGE);
    expect(tx.value).toBe(0n);

    const decoded = decodeFunctionData({ abi: SET_PRICE_ABI, data: tx.data });
    expect(decoded.args).toEqual([TOKEN, 345_297_696n, 42n, 1_795_000_000n, 8453n, FEED, false]);
  });

  it("encodes buy and sell with the deadline", () => {
    const buy = encodeTrade(EXCHANGE, {
      side: "buy",
      stockToken: TOKEN,
      amountIn: 1_000_000n,
      minAmountOut: 4_326_086_956_521_738n,
      deadline: 1_795_000_060,
    });
    const decodedBuy = decodeFunctionData({ abi: TRADE_ABI, data: buy.data });
    expect(decodedBuy.functionName).toBe("buy");
    expect(decodedBuy.args).toEqual([TOKEN, 1_000_000n, 4_326_086_956_521_738n, 1_795_000_060n]);

    const sell = encodeTrade(EXCHANGE, {
      side: "sell",
      stockToken: TOKEN,
      amountIn: 10n ** 18n,
      minAmountOut: 230_000_000n,
      deadline: 1_795_000_060,
    });
    const decodedSell = decodeFunctionData({ abi: TRADE_ABI, data: sell.data });
    expect(decodedSell.functionName).toBe("sell");
    expect(decodedSell.args).toEqual([TOKEN, 10n ** 18n, 230_000_000n, 1_795_000_060n]);
  });
});

describe("intent hashing", () => {
  const fields = {
    chainId: 84_532,
    exchange: EXCHANGE,
    stockToken: TOKEN,
    trader: TRADER,
    side: "buy" as const,
    amountIn: 1_000_000n,
    minAmountOut: 4_326_086_956_521_738n,
    deadline: 1_795_000_060,
    priceUsdcPerWholeToken: 230_000_000n,
    sourceRoundId: 42n,
    sourceUpdatedAt: 1_795_000_000,
  };

  it("is deterministic", () => {
    expect(hashTradeIntent(fields)).toBe(hashTradeIntent({ ...fields }));
  });

  it("hashes a quote deterministically and binds expiry", () => {
    const quoteFields = {
      chainId: 84_532,
      stockToken: TOKEN,
      side: "buy" as const,
      amountIn: 1_000_000n,
      amountOut: 4_347_826_086_956_521n,
      minAmountOut: 4_326_086_956_521_738n,
      priceUsdcPerWholeToken: 230_000_000n,
      sourceRoundId: 42n,
      sourceUpdatedAt: 1_795_000_000,
      expiresAt: 1_795_000_060,
    };
    expect(hashQuote(quoteFields)).toBe(hashQuote({ ...quoteFields }));
    expect(hashQuote({ ...quoteFields, expiresAt: quoteFields.expiresAt + 1 })).not.toBe(
      hashQuote(quoteFields),
    );
    expect(hashQuote({ ...quoteFields, amountOut: 1n })).not.toBe(hashQuote(quoteFields));
  });

  it("changes when any bound field changes", () => {
    const base = hashTradeIntent(fields);
    expect(hashTradeIntent({ ...fields, amountIn: fields.amountIn + 1n })).not.toBe(base);
    expect(hashTradeIntent({ ...fields, minAmountOut: fields.minAmountOut + 1n })).not.toBe(base);
    expect(hashTradeIntent({ ...fields, deadline: fields.deadline + 1 })).not.toBe(base);
    expect(hashTradeIntent({ ...fields, sourceRoundId: 43n })).not.toBe(base);
    expect(hashTradeIntent({ ...fields, stockToken: TRADER })).not.toBe(base);
    expect(hashTradeIntent({ ...fields, side: "sell" })).not.toBe(base);
  });
});
