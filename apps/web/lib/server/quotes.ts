import { randomUUID } from "node:crypto";

import {
  TESTNET_TRADE_POLICY,
  TESTNET_ASSETS,
  fromBaseUnits,
  type AssetDefinition,
  type PriceObservation,
} from "@kyrox/core";
import type { Address } from "@kyrox/core";
import { DrizzleObservationStore } from "@kyrox/price";
import { createDatabase } from "@kyrox/db";
import { QuoteService } from "@kyrox/trade-intent";

import { assetAddress, exchangeAddress, type RuntimeEnvironment } from "./env.js";
import { createChainClient, ERC20_ABI } from "./chain.js";
import { quoteSimulationFlags } from "./labels.js";
import { PolicyRpcPolicy } from "./policy.js";
import { DrizzleQuoteStore, DrizzleIntentStore } from "./stores.js";

export interface QuoteResponse {
  readonly quoteId: string;
  readonly quoteToken: string;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly priceUsdc: string;
  readonly amountIn: string;
  readonly amountOut: string;
  readonly minAmountOut: string;
  readonly sourceUpdatedAt: number;
  readonly expiresAt: number;
  readonly simulated: boolean;
  readonly simulatedPrice: boolean;
  readonly limits: {
    readonly minUsdc: string;
    readonly maxUsdc: string;
    readonly dailyUsdc: string;
  };
}

function asObservation(
  record: Awaited<ReturnType<DrizzleObservationStore["latestValidObservation"]>>,
): PriceObservation {
  if (record === null || record.referencePriceUsdcPerWholeToken === null) {
    throw new Error("No valid price observation is available.");
  }
  return {
    assetSymbol: record.assetSymbol,
    priceUsdcPerWholeToken: record.referencePriceUsdcPerWholeToken,
    sourceRoundId: record.sourceRoundId,
    sourceUpdatedAt: record.sourceUpdatedAt,
    observedAt: record.observedAt,
    sourceChainId: record.sourceChainId,
    feedAddress:
      record.feedAddress === "0x0000000000000000000000000000000000000000"
        ? null
        : record.feedAddress,
    sourceKind:
      record.feedAddress === "0x0000000000000000000000000000000000000000"
        ? "simulated"
        : "chainlink-coinbase",
  };
}

function assetFor(env: RuntimeEnvironment, symbol: string): AssetDefinition {
  const asset = TESTNET_ASSETS.find((entry) => entry.symbol === symbol);
  if (asset === undefined) throw new Error(`Unsupported asset: ${symbol}.`);
  return { ...asset, stockToken: assetAddress(env, symbol) };
}

export async function issueUserQuote(
  env: RuntimeEnvironment,
  session: { readonly address: string },
  input: { symbol: string; side: "buy" | "sell"; amountIn: string; slippageBps: number },
): Promise<QuoteResponse> {
  const asset = assetFor(env, input.symbol);
  const db = createDatabase(env.databaseUrl);
  try {
    const observation = asObservation(
      await new DrizzleObservationStore(db.db).latestValidObservation(input.symbol),
    );
    const service = new QuoteService({
      secret: env.quoteSecret,
      store: new DrizzleQuoteStore(db.db),
      policy: new PolicyRpcPolicy(env),
      policyConfig: TESTNET_TRADE_POLICY,
      maxTtlSeconds: 60,
    });
    const issued = await service.issueQuote({
      session: { trader: session.address as Address },
      asset,
      observation,
      side: input.side,
      amountIn: BigInt(input.amountIn),
      maxSlippageBps: input.slippageBps,
    });
    return {
      quoteId: issued.quoteId,
      quoteToken: issued.quoteToken,
      symbol: input.symbol,
      side: input.side,
      priceUsdc: fromBaseUnits(issued.quote.priceUsdcPerWholeToken, 6),
      amountIn: fromBaseUnits(
        issued.quote.amountIn,
        input.side === "buy" ? 6 : asset.stockDecimals,
      ),
      amountOut: fromBaseUnits(
        issued.quote.amountOut,
        input.side === "buy" ? asset.stockDecimals : 6,
      ),
      minAmountOut: fromBaseUnits(
        issued.quote.minAmountOut,
        input.side === "buy" ? asset.stockDecimals : 6,
      ),
      sourceUpdatedAt: issued.quote.sourceUpdatedAt,
      expiresAt: issued.expiresAt,
      ...quoteSimulationFlags(env.mode, observation),
      limits: {
        minUsdc: fromBaseUnits(TESTNET_TRADE_POLICY.minTradeUsdc, 6),
        maxUsdc: fromBaseUnits(TESTNET_TRADE_POLICY.maxTradeUsdc, 6),
        dailyUsdc: fromBaseUnits(TESTNET_TRADE_POLICY.dailyLimitUsdc, 6),
      },
    };
  } finally {
    await db.pool.end();
  }
}

export interface PrepareResult {
  readonly intentId: string;
  readonly quoteId: string;
  /** Exact base-unit input the wallet must approve for this intent. */
  readonly amountIn: string;
  readonly to: Address;
  readonly data: `0x${string}`;
  readonly value: "0";
  readonly hash: `0x${string}`;
  readonly deadline: number;
  readonly simulated: boolean;
}

export async function prepareUserIntent(
  env: RuntimeEnvironment,
  session: { readonly address: string },
  quoteId: string,
  quoteToken: string,
): Promise<PrepareResult> {
  const db = createDatabase(env.databaseUrl);
  try {
    const record = await new DrizzleQuoteStore(db.db).get(quoteId);
    if (record === null) throw new Error("Quote was not found.");
    const asset = assetFor(env, record.assetSymbol);
    const service = new QuoteService({
      secret: env.quoteSecret,
      store: new DrizzleQuoteStore(db.db),
      policy: new PolicyRpcPolicy(env),
      policyConfig: TESTNET_TRADE_POLICY,
      maxTtlSeconds: 60,
    });
    const prepared = await service.prepareIntent({
      session: { trader: session.address as Address },
      quoteId,
      quoteToken,
      asset,
      exchange: exchangeAddress(env),
      deadline: Math.min(Math.floor(Date.now() / 1000) + 60, record.expiresAt),
      reader: {
        getChainId: async () => 84_532,
        getTokenDecimals: async (token) => {
          const client = createChainClient(env);
          return client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" });
        },
      },
    });
    const id = randomUUID();
    await new DrizzleIntentStore(db.db).insert({
      id,
      quoteId,
      trader: session.address,
      assetSymbol: record.assetSymbol,
      side: prepared.side,
      amountIn: prepared.amountIn,
      minAmountOut: prepared.minAmountOut,
      deadline: BigInt(prepared.deadline),
      calldata: prepared.data,
      intentHash: prepared.hash,
    });
    return {
      intentId: id,
      quoteId,
      amountIn: prepared.amountIn.toString(),
      to: prepared.to,
      data: prepared.data,
      value: "0",
      hash: prepared.hash,
      deadline: prepared.deadline,
      simulated: env.mode === "local-anvil",
    };
  } finally {
    await db.pool.end();
  }
}

export async function quoteById(env: RuntimeEnvironment, quoteId: string) {
  const db = createDatabase(env.databaseUrl);
  try {
    return (await new DrizzleQuoteStore(db.db).get(quoteId)) ?? null;
  } finally {
    await db.pool.end();
  }
}
