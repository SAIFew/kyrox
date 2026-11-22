import {
  BASE_SEPOLIA_CHAIN_ID,
  CoreError,
  createQuote,
  evaluateTradePolicy,
  isCoreError,
  type Address,
  type AssetDefinition,
  type PolicyContext,
  type PriceObservation,
  type Quote,
  type QuoteRequest,
  type TradePolicyConfig,
} from "@kyrox/core";
import { encodeTrade, hashQuote, hashTradeIntent, type UnsignedTransaction } from "@kyrox/protocol";

export type IntentErrorCode =
  | "WRONG_CHAIN"
  | "TOKEN_MISMATCH"
  | "DECIMALS_MISMATCH"
  | "INVALID_DEADLINE"
  | "EXPIRED"
  | "QUOTE_MISMATCH"
  | "STALE_OBSERVATION"
  | "POLICY_REJECTED"
  | "INVALID_QUOTE";

export class IntentError extends Error {
  override readonly name = "IntentError";

  constructor(
    readonly code: IntentErrorCode,
    message: string,
    readonly details: readonly string[] = [],
  ) {
    super(message);
  }
}

export interface SepoliaTokenReader {
  getChainId(): Promise<number>;
  getTokenDecimals(token: Address): Promise<number>;
}

export interface PrepareTradeIntentParams {
  /** Quote previously shown to the user. It is revalidated, never trusted. */
  readonly quote: Quote;
  /** The current observation read at approval time. */
  readonly observation: PriceObservation;
  /** Original request the quote was built from. */
  readonly request: QuoteRequest;
  readonly asset: AssetDefinition;
  readonly trader: Address;
  readonly exchange: Address;
  /** Unix seconds after which the transaction may not execute. */
  readonly deadline: number;
  readonly nowSeconds: number;
  readonly policyConfig: TradePolicyConfig;
  readonly policyContext: PolicyContext;
  readonly reader: SepoliaTokenReader;
}

export interface PreparedTradeIntent extends UnsignedTransaction {
  readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  readonly hash: `0x${string}`;
  /** Hash of the exact quote that was revalidated. */
  readonly quoteHash: `0x${string}`;
  readonly assetSymbol: string;
  readonly stockToken: Address;
  readonly trader: Address;
  readonly side: "buy" | "sell";
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly minAmountOut: bigint;
  readonly deadline: number;
  readonly priceUsdcPerWholeToken: bigint;
  readonly sourceRoundId: bigint;
  readonly sourceUpdatedAt: number;
}

function mismatch(message: string): never {
  throw new IntentError("QUOTE_MISMATCH", message);
}

function asIntentError(error: unknown): never {
  if (isCoreError(error)) {
    const code: IntentErrorCode =
      error.code === "STALE_PRICE" || error.code === "MARKET_CLOSED"
        ? "STALE_OBSERVATION"
        : error.code === "QUOTE_EXPIRED"
          ? "EXPIRED"
          : "INVALID_QUOTE";
    throw new IntentError(code, error.message);
  }
  throw error;
}

/**
 * Revalidate a displayed quote against current state and prepare unsigned calldata.
 *
 * This function never signs and never sends. The user's wallet remains the only
 * signer, and the returned transaction still has to be signed and submitted by
 * the client.
 */
export async function prepareTradeIntent(
  params: PrepareTradeIntentParams,
): Promise<PreparedTradeIntent> {
  const { quote, observation, request, asset, trader, exchange, deadline, nowSeconds } = params;

  const chainId = await params.reader.getChainId();
  if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new IntentError("WRONG_CHAIN", `RPC is on chain ${chainId}, expected 84532.`);
  }
  if (quote.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new IntentError(
      "WRONG_CHAIN",
      `Quote is bound to chain ${quote.chainId}, expected 84532.`,
    );
  }
  if (params.policyContext.nowSeconds !== nowSeconds) {
    throw new IntentError("QUOTE_MISMATCH", "Policy clock and intent clock disagree.");
  }
  if (asset.symbol !== quote.assetSymbol) {
    mismatch(`Quote is for ${quote.assetSymbol}, asset is ${asset.symbol}.`);
  }
  if (asset.stockToken === null) {
    throw new IntentError(
      "TOKEN_MISMATCH",
      `Asset ${asset.symbol} has no deployed Base Sepolia token address.`,
    );
  }
  if (quote.stockToken !== asset.stockToken) {
    throw new IntentError(
      "TOKEN_MISMATCH",
      `Quote token ${String(quote.stockToken)} does not match ${asset.stockToken}.`,
    );
  }
  if (request.assetSymbol !== quote.assetSymbol || request.side !== quote.side) {
    mismatch("Quote request does not match the quote.");
  }

  const decimals = await params.reader.getTokenDecimals(asset.stockToken);
  if (decimals !== quote.stockDecimals) {
    throw new IntentError(
      "DECIMALS_MISMATCH",
      `Token reports ${decimals} decimals but the quote assumes ${quote.stockDecimals}.`,
    );
  }

  if (!Number.isInteger(deadline) || deadline <= 0) {
    throw new IntentError("INVALID_DEADLINE", "Deadline must be a positive integer timestamp.");
  }
  if (nowSeconds > deadline) {
    throw new IntentError("EXPIRED", "Deadline has already passed.");
  }
  if (quote.expiresAt <= nowSeconds) {
    throw new IntentError("EXPIRED", "Quote has expired.");
  }
  if (deadline > quote.expiresAt) {
    throw new IntentError(
      "INVALID_DEADLINE",
      "Intent deadline may not outlive the quote it was built from.",
    );
  }

  const ttl = quote.expiresAt - nowSeconds;
  let recomputed: Quote;
  try {
    recomputed = createQuote(request, asset, observation, {
      nowSeconds,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      freshnessConfig: params.policyContext.freshness,
      session: params.policyContext.session,
      priceBounds: params.policyContext.priceBounds,
      quoteTtlSeconds: ttl,
    });
  } catch (error) {
    asIntentError(error);
  }

  if (
    recomputed.side !== quote.side ||
    recomputed.amountIn !== quote.amountIn ||
    recomputed.amountOut !== quote.amountOut ||
    recomputed.minAmountOut !== quote.minAmountOut ||
    recomputed.priceUsdcPerWholeToken !== quote.priceUsdcPerWholeToken ||
    recomputed.sourceRoundId !== quote.sourceRoundId ||
    recomputed.sourceUpdatedAt !== quote.sourceUpdatedAt ||
    recomputed.stockToken !== quote.stockToken ||
    recomputed.expiresAt !== quote.expiresAt
  ) {
    mismatch("Recomputed quote does not match the supplied quote.");
  }
  if (quote.minAmountOut <= 0n || quote.minAmountOut > quote.amountOut) {
    throw new IntentError("INVALID_QUOTE", "Minimum output is inconsistent with the quote.");
  }

  const decision = evaluateTradePolicy(recomputed, params.policyConfig, params.policyContext);
  if (!decision.allowed) {
    throw new IntentError(
      "POLICY_REJECTED",
      "Trade policy rejected the intent.",
      decision.violations.map((violation) => violation.code),
    );
  }

  const transaction = encodeTrade(exchange, {
    side: recomputed.side,
    stockToken: asset.stockToken,
    amountIn: recomputed.amountIn,
    minAmountOut: recomputed.minAmountOut,
    deadline,
  });

  const quoteHash = hashQuote({
    chainId: BASE_SEPOLIA_CHAIN_ID,
    stockToken: asset.stockToken,
    side: recomputed.side,
    amountIn: recomputed.amountIn,
    amountOut: recomputed.amountOut,
    minAmountOut: recomputed.minAmountOut,
    priceUsdcPerWholeToken: recomputed.priceUsdcPerWholeToken,
    sourceRoundId: recomputed.sourceRoundId,
    sourceUpdatedAt: recomputed.sourceUpdatedAt,
    expiresAt: recomputed.expiresAt,
  });

  const hash = hashTradeIntent({
    chainId: BASE_SEPOLIA_CHAIN_ID,
    exchange,
    stockToken: asset.stockToken,
    trader,
    side: recomputed.side,
    amountIn: recomputed.amountIn,
    minAmountOut: recomputed.minAmountOut,
    deadline,
    priceUsdcPerWholeToken: recomputed.priceUsdcPerWholeToken,
    sourceRoundId: recomputed.sourceRoundId,
    sourceUpdatedAt: recomputed.sourceUpdatedAt,
  });

  return {
    ...transaction,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    hash,
    quoteHash,
    assetSymbol: recomputed.assetSymbol,
    stockToken: asset.stockToken,
    trader,
    side: recomputed.side,
    amountIn: recomputed.amountIn,
    amountOut: recomputed.amountOut,
    minAmountOut: recomputed.minAmountOut,
    deadline,
    priceUsdcPerWholeToken: recomputed.priceUsdcPerWholeToken,
    sourceRoundId: recomputed.sourceRoundId,
    sourceUpdatedAt: recomputed.sourceUpdatedAt,
  };
}

export { CoreError };
