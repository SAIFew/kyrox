import { CoreError, isCoreError } from "@kyrox/core";

import { normalizeChainlinkAnswer } from "../normalize.js";
import type { EvmReadClient, FeedConfig, RawFeedObservation } from "./types.js";
import { FeedValidationError, SOURCE_CHAIN_ID } from "./types.js";

export interface FeedReader {
  read(feed: FeedConfig): Promise<RawFeedObservation>;
}

const CODE_ZERO = "0x";

/**
 * Read-only Chainlink V3 aggregator proxy reader.
 *
 * Uses `latestRoundData()` exclusively: `latestAnswer()` carries no freshness
 * timestamp and is therefore unusable for a staleness-bound price system.
 */
export class ChainlinkFeedReader implements FeedReader {
  readonly #client: EvmReadClient;
  readonly #nowSeconds: () => number;

  constructor(
    client: EvmReadClient,
    nowSeconds: () => number = () => Math.floor(Date.now() / 1000),
  ) {
    this.#client = client;
    this.#nowSeconds = nowSeconds;
  }

  async read(feed: FeedConfig): Promise<RawFeedObservation> {
    if (!feed.enabled) {
      throw new FeedValidationError("FEED_DISABLED", `Feed for ${feed.assetSymbol} is disabled.`);
    }
    if (feed.expectedChainId !== SOURCE_CHAIN_ID) {
      throw new FeedValidationError(
        "WRONG_SOURCE_CHAIN",
        `Feed ${feed.assetSymbol} is configured for chain ${feed.expectedChainId}, not ${SOURCE_CHAIN_ID}.`,
      );
    }

    const chainId = await this.#client.getChainId();
    if (chainId !== SOURCE_CHAIN_ID) {
      throw new FeedValidationError(
        "WRONG_SOURCE_CHAIN",
        `RPC is on chain ${chainId}; KYROX reads feeds only from ${SOURCE_CHAIN_ID}.`,
      );
    }

    const bytecode = await this.#client.getBytecode(feed.feedAddress);
    if (bytecode === undefined || bytecode === CODE_ZERO) {
      throw new FeedValidationError(
        "MISSING_CONTRACT",
        `No contract code at ${feed.feedAddress} on chain ${SOURCE_CHAIN_ID}.`,
      );
    }

    const decimals = await this.#client.readDecimals(feed.feedAddress);
    if (
      !Number.isInteger(decimals) ||
      decimals < 0 ||
      decimals > 18 ||
      decimals !== feed.expectedDecimals
    ) {
      throw new FeedValidationError(
        "INVALID_DECIMALS",
        `Feed ${feed.assetSymbol} reports ${decimals} decimals; expected ${feed.expectedDecimals}.`,
      );
    }

    const description = await this.#client.readDescription(feed.feedAddress);
    if (description !== feed.expectedDescription) {
      throw new FeedValidationError(
        "DESCRIPTION_MISMATCH",
        `Feed ${feed.assetSymbol} describes itself as "${description}", expected "${feed.expectedDescription}".`,
      );
    }

    const round = await this.#client.readLatestRoundData(feed.feedAddress);
    const nowSeconds = this.#nowSeconds();

    const partial = {
      sourceRoundId: round.roundId,
      rawAnswer: round.answer,
      feedDecimals: decimals,
      sourceUpdatedAt: Number(round.updatedAt),
      sourceDescription: description,
    };

    if (round.roundId <= 0n) {
      throw new FeedValidationError("INVALID_ROUND", "Round id must be positive.", partial);
    }
    if (round.answeredInRound < round.roundId) {
      throw new FeedValidationError(
        "INCOMPLETE_ROUND",
        `Round ${round.roundId} was answered in round ${round.answeredInRound}.`,
        partial,
      );
    }
    if (round.answer <= 0n) {
      throw new FeedValidationError("NON_POSITIVE_ANSWER", "Answer must be positive.", partial);
    }
    if (round.updatedAt <= 0n || round.startedAt <= 0n) {
      throw new FeedValidationError("INVALID_TIMESTAMP", "Timestamps must be positive.", partial);
    }
    if (round.updatedAt > BigInt(nowSeconds)) {
      throw new FeedValidationError(
        "FUTURE_TIMESTAMP",
        `Feed updatedAt ${round.updatedAt} is later than now ${nowSeconds}.`,
        partial,
      );
    }
    if (round.updatedAt > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new FeedValidationError("INVALID_TIMESTAMP", "Timestamp exceeds safe range.", partial);
    }

    let normalized: bigint;
    try {
      normalized = normalizeChainlinkAnswer(round.answer, decimals);
    } catch (error) {
      const message =
        isCoreError(error) && error.code === "INVALID_PRICE"
          ? error.message
          : "Answer could not be normalized.";
      throw new FeedValidationError(
        isCoreError(error) && error.code === "INVALID_DECIMALS"
          ? "INVALID_DECIMALS"
          : "IMPLAUSIBLE_ANSWER",
        message,
        partial,
      );
    }

    if (normalized <= 0n) {
      throw new FeedValidationError("IMPLAUSIBLE_ANSWER", "Normalized price is zero.", partial);
    }

    return {
      assetSymbol: feed.assetSymbol,
      referenceSymbol: feed.referenceSymbol,
      feedAddress: feed.feedAddress,
      sourceChainId: SOURCE_CHAIN_ID,
      sourceDescription: description,
      feedDecimals: decimals,
      rawAnswer: round.answer,
      sourceRoundId: round.roundId,
      sourceUpdatedAt: Number(round.updatedAt),
      observedAt: nowSeconds,
      referencePriceUsdcPerWholeToken: normalized,
    };
  }
}

/** Re-exported so callers can distinguish a validation failure from an RPC failure. */
export function isFeedValidationError(error: unknown): error is FeedValidationError {
  return error instanceof FeedValidationError;
}

/** Re-exported for symmetry with `isCoreError` usage in callers. */
export { CoreError };
