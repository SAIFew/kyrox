import type { Address } from "@kyrox/core";

/** Base Mainnet is the only chain this service reads. */
export const SOURCE_CHAIN_ID = 8_453 as const;

export interface LatestRoundData {
  readonly roundId: bigint;
  readonly answer: bigint;
  readonly startedAt: bigint;
  readonly updatedAt: bigint;
  readonly answeredInRound: bigint;
}

/**
 * Minimal EVM read surface.
 *
 * The adapter depends on this interface rather than a concrete client so tests
 * can supply deterministic values and no test ever needs a live RPC.
 */
export interface EvmReadClient {
  getChainId(): Promise<number>;
  getBytecode(address: Address): Promise<string | undefined>;
  readDecimals(address: Address): Promise<number>;
  readDescription(address: Address): Promise<string>;
  readLatestRoundData(address: Address): Promise<LatestRoundData>;
}

/** One verified source feed binding a synthetic testnet asset to a real feed. */
export interface FeedConfig {
  /** Synthetic asset symbol used by the KYROX catalogue, e.g. `tAAPL`. */
  readonly assetSymbol: string;
  /** Real-world reference symbol, e.g. `AAPL`. */
  readonly referenceSymbol: string;
  readonly feedAddress: Address;
  readonly expectedChainId: typeof SOURCE_CHAIN_ID;
  readonly expectedDecimals: number;
  readonly expectedDescription: string;
  /** Authoritative document the address was taken from. */
  readonly source: string;
  /** Date the address and description were verified against the chain. */
  readonly verifiedAt: string;
  readonly enabled: boolean;
}

export interface RawFeedObservation {
  readonly assetSymbol: string;
  readonly referenceSymbol: string;
  readonly feedAddress: Address;
  readonly sourceChainId: typeof SOURCE_CHAIN_ID;
  readonly sourceDescription: string;
  readonly feedDecimals: number;
  readonly rawAnswer: bigint;
  readonly sourceRoundId: bigint;
  /** Original feed timestamp, in unix seconds. Never rewritten. */
  readonly sourceUpdatedAt: number;
  /** When our worker read it, in unix seconds. */
  readonly observedAt: number;
  /** Normalized to the core convention: 6-decimal USDC per whole token. */
  readonly referencePriceUsdcPerWholeToken: bigint;
}

export type FeedValidationCode =
  | "FEED_DISABLED"
  | "WRONG_SOURCE_CHAIN"
  | "MISSING_CONTRACT"
  | "INVALID_DECIMALS"
  | "DESCRIPTION_MISMATCH"
  | "INVALID_ROUND"
  | "INCOMPLETE_ROUND"
  | "NON_POSITIVE_ANSWER"
  | "INVALID_TIMESTAMP"
  | "FUTURE_TIMESTAMP"
  | "IMPLAUSIBLE_ANSWER";

export interface PartialFeedSnapshot {
  readonly sourceRoundId?: bigint;
  readonly rawAnswer?: bigint;
  readonly feedDecimals?: number;
  readonly sourceUpdatedAt?: number;
  readonly sourceDescription?: string;
}

export class FeedValidationError extends Error {
  override readonly name = "FeedValidationError";

  constructor(
    readonly code: FeedValidationCode,
    message: string,
    readonly partial: PartialFeedSnapshot = {},
  ) {
    super(message);
  }
}
