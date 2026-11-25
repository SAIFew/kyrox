import { randomUUID } from "node:crypto";

import {
  DEFAULT_QUOTE_TTL_SECONDS,
  TESTNET_ASSETS,
  fromBaseUnits,
  remainingDailyLimit,
  type Address,
  type AssetDefinition,
  type PriceObservation,
} from "@kyrox/core";
import {
  DrizzleObservationStore,
  assertObservationProvenance,
  feedForAsset,
  validateStoredObservation,
} from "@kyrox/price";
import { KYROX_EXCHANGE_ABI } from "@kyrox/protocol";
import { QuoteService, QuoteServiceError, type SepoliaTokenReader } from "@kyrox/trade-intent";

import type { QuotePayload } from "../market-types.js";
import { appDatabase } from "./database.js";
import { findUserByAddress } from "@kyrox/db";
import { assetAddress, exchangeAddress, type RuntimeEnvironment } from "./env.js";
import { createChainClient, ERC20_ABI } from "./chain.js";
import { quoteSimulationFlags } from "./labels.js";
import { PolicyRpcPolicy } from "./policy.js";
import { DrizzleQuoteStore, DrizzleIntentStore } from "./stores.js";
import { readPolicyForQuote } from "./policy-store.js";

export type { QuotePayload } from "../market-types.js";

/** Server-controlled quote lifetime for the testnet MVP. */
const QUOTE_TTL_SECONDS = DEFAULT_QUOTE_TTL_SECONDS;

function asObservation(
  record: Awaited<ReturnType<DrizzleObservationStore["latestValidObservation"]>>,
  env: RuntimeEnvironment,
  nowSeconds: number,
): PriceObservation {
  if (record === null) throw new Error("No valid price observation is available.");
  return validateStoredObservation(record, {
    nowSeconds,
    allowSimulated: env.mode === "local-anvil",
  });
}

function assetFor(
  env: RuntimeEnvironment,
  symbol: string,
  observation: PriceObservation,
  nowSeconds: number,
): AssetDefinition {
  const asset = TESTNET_ASSETS.find((entry) => entry.symbol === symbol);
  if (asset === undefined) throw new Error(`Unsupported asset: ${symbol}.`);
  assertObservationProvenance(observation, {
    nowSeconds,
    allowSimulated: env.mode === "local-anvil",
  });
  return {
    ...asset,
    stockToken: assetAddress(env, symbol),
    // Never inherit the Phase-0 simulated catalogue label in production. The
    // source kind comes only from the validated persisted feed binding.
    priceSourceKind: observation.sourceKind,
  };
}

function createTradeReader(env: RuntimeEnvironment): SepoliaTokenReader {
  const client = createChainClient(env);
  return {
    getChainId: () => client.getChainId(),
    getTokenDecimals: async (token) => {
      return client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" });
    },
    readObservation: async (exchange, stockToken) => {
      const [price, roundId, sourceUpdatedAt, publishedAt, sourceChainId, feedAddress, simulated] =
        await client.readContract({
          address: exchange,
          abi: KYROX_EXCHANGE_ABI,
          functionName: "observation",
          args: [stockToken],
        });
      return {
        priceUsdcPerWholeToken: price,
        sourceRoundId: roundId,
        sourceUpdatedAt: Number(sourceUpdatedAt),
        publishedAt: Number(publishedAt),
        sourceChainId: Number(sourceChainId),
        feedAddress,
        simulated,
      };
    },
  };
}

export async function issueUserQuote(
  env: RuntimeEnvironment,
  session: { readonly address: string },
  input: { symbol: string; side: "buy" | "sell"; amountIn: string; slippageBps: number },
): Promise<QuotePayload> {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const db = appDatabase(env.databaseUrl);
  const account = await findUserByAddress(db.db, session.address);
  if (account?.status === "banned") {
    throw new QuoteServiceError("ACCOUNT_BANNED", "This account is not eligible to trade.");
  }
  const observation = asObservation(
    await new DrizzleObservationStore(db.db).latestValidObservation(
      input.symbol,
      // Production selection is constrained to the verified feed before any
      // provenance validation. Local rehearsal explicitly selects zero feed.
      env.mode === "local-anvil"
        ? "0x0000000000000000000000000000000000000000"
        : feedForAsset(input.symbol).feedAddress,
    ),
    env,
    nowSeconds,
  );
  // Revalidate the selected row against the exact verified feed binding.
  const asset = assetFor(env, input.symbol, observation, nowSeconds);
  const effective = await readPolicyForQuote(db.db);
  if (!effective.tradingEnabled) {
    throw new QuoteServiceError(
      "TRADING_PAUSED",
      "Testnet trading is paused by the operator right now.",
    );
  }
  const policy = new PolicyRpcPolicy(env);
  const service = new QuoteService({
    secret: env.quoteSecret,
    store: new DrizzleQuoteStore(db.db),
    policy,
    policyConfig: effective.policy,
    exchange: exchangeAddress(env),
    reader: createTradeReader(env),
    maxTtlSeconds: QUOTE_TTL_SECONDS,
  });
  const issued = await service.issueQuote({
    session: { trader: session.address as Address },
    asset,
    observation,
    side: input.side,
    amountIn: BigInt(input.amountIn),
    maxSlippageBps: input.slippageBps,
  });
  const spent = await policy.dailySpentUsdc(session.address as Address);
  const remaining = remainingDailyLimit(effective.policy, spent);

  return {
    quoteId: issued.quoteId,
    quoteToken: issued.quoteToken,
    symbol: input.symbol,
    side: input.side,
    priceUsdc: fromBaseUnits(issued.quote.priceUsdcPerWholeToken, 6),
    amountIn: issued.quote.amountIn.toString(),
    amountOut: issued.quote.amountOut.toString(),
    minAmountOut: issued.quote.minAmountOut.toString(),
    amountInLabel: fromBaseUnits(
      issued.quote.amountIn,
      input.side === "buy" ? 6 : asset.stockDecimals,
    ),
    amountOutLabel: fromBaseUnits(
      issued.quote.amountOut,
      input.side === "buy" ? asset.stockDecimals : 6,
    ),
    minAmountOutLabel: fromBaseUnits(
      issued.quote.minAmountOut,
      input.side === "buy" ? asset.stockDecimals : 6,
    ),
    sourceUpdatedAt: issued.quote.sourceUpdatedAt,
    expiresAt: issued.expiresAt,
    ttlSeconds: issued.ttlSeconds,
    ...quoteSimulationFlags(env.mode, observation),
    limits: {
      minUsdc: fromBaseUnits(effective.policy.minTradeUsdc, 6),
      maxUsdc: fromBaseUnits(effective.policy.maxTradeUsdc, 6),
      dailyUsdc: fromBaseUnits(effective.policy.dailyLimitUsdc, 6),
      remainingUsdc: fromBaseUnits(remaining, 6),
    },
  };
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
  const db = appDatabase(env.databaseUrl);
  const account = await findUserByAddress(db.db, session.address);
  if (account?.status === "banned") {
    throw new QuoteServiceError("ACCOUNT_BANNED", "This account is not eligible to trade.");
  }
  const record = await new DrizzleQuoteStore(db.db).get(quoteId);
  if (record === null) throw new Error("Quote was not found.");
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const asset = assetFor(env, record.assetSymbol, record.observation, nowSeconds);
  const effective = await readPolicyForQuote(db.db);
  if (!effective.tradingEnabled) {
    throw new QuoteServiceError(
      "TRADING_PAUSED",
      "Testnet trading is paused by the operator right now.",
    );
  }
  const service = new QuoteService({
    secret: env.quoteSecret,
    store: new DrizzleQuoteStore(db.db),
    policy: new PolicyRpcPolicy(env),
    policyConfig: effective.policy,
    exchange: exchangeAddress(env),
    reader: createTradeReader(env),
    maxTtlSeconds: QUOTE_TTL_SECONDS,
  });
  const prepared = await service.prepareIntent({
    session: { trader: session.address as Address },
    quoteId,
    quoteToken,
    asset,
    exchange: exchangeAddress(env),
    deadline: Math.min(nowSeconds + QUOTE_TTL_SECONDS, record.expiresAt),
    reader: createTradeReader(env),
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
}

export async function quoteById(env: RuntimeEnvironment, quoteId: string) {
  const db = appDatabase(env.databaseUrl);
  return (await new DrizzleQuoteStore(db.db).get(quoteId)) ?? null;
}
