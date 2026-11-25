import { CoreError, assertPriceObservation, isCoreError, type PriceObservation } from "@kyrox/core";

import { feedForAsset, type FeedConfig } from "./feeds/registry.js";
import { SOURCE_CHAIN_ID } from "./feeds/types.js";
import { normalizeChainlinkAnswer } from "./normalize.js";
import type { ObservationInsert } from "./persistence/types.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type ObservationProvenanceCode =
  | "INVALID_STATUS"
  | "INVALID_PRICE"
  | "WRONG_SOURCE_CHAIN"
  | "FEED_MISMATCH"
  | "DECIMALS_MISMATCH"
  | "DESCRIPTION_MISMATCH"
  | "PRICE_MISMATCH"
  | "INVALID_TIMESTAMP"
  | "SIMULATION_NOT_ALLOWED"
  | "UNKNOWN_PROVENANCE";

export class ObservationProvenanceError extends Error {
  override readonly name = "ObservationProvenanceError";

  constructor(
    readonly code: ObservationProvenanceCode,
    message: string,
  ) {
    super(message);
  }
}

export interface ObservationProvenanceOptions {
  readonly nowSeconds: number;
  /** Only an explicitly local runtime may consume a feedless simulated row. */
  readonly allowSimulated?: boolean;
  readonly feed?: FeedConfig;
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function isZeroAddress(address: string): boolean {
  return sameAddress(address, ZERO_ADDRESS);
}

function fail(code: ObservationProvenanceCode, message: string): never {
  throw new ObservationProvenanceError(code, message);
}

function expectedFeed(assetSymbol: string, configured: FeedConfig | undefined): FeedConfig {
  try {
    const feed = configured ?? feedForAsset(assetSymbol);
    if (!feed.enabled) fail("UNKNOWN_PROVENANCE", `Feed for ${assetSymbol} is disabled.`);
    if (feed.assetSymbol !== assetSymbol) {
      fail("FEED_MISMATCH", `Configured feed is for ${feed.assetSymbol}, not ${assetSymbol}.`);
    }
    if (feed.expectedChainId !== SOURCE_CHAIN_ID) {
      fail("WRONG_SOURCE_CHAIN", `Configured feed for ${assetSymbol} is on the wrong chain.`);
    }
    return feed;
  } catch (error) {
    if (error instanceof ObservationProvenanceError) throw error;
    fail("UNKNOWN_PROVENANCE", `No verified feed is configured for ${assetSymbol}.`);
  }
}

function validateCommon(
  observation: PriceObservation,
  options: ObservationProvenanceOptions,
): void {
  if (!Number.isInteger(options.nowSeconds) || options.nowSeconds <= 0) {
    fail("INVALID_TIMESTAMP", "Provenance validation requires a positive integer clock.");
  }
  try {
    assertPriceObservation(observation, options.nowSeconds);
  } catch (error) {
    if (isCoreError(error)) {
      fail(
        error.code === "INVALID_TIMESTAMP" || error.code === "FUTURE_TIMESTAMP"
          ? "INVALID_TIMESTAMP"
          : error.code === "INVALID_ROUND"
            ? "INVALID_PRICE"
            : "UNKNOWN_PROVENANCE",
        error.message,
      );
    }
    throw error;
  }
  if (observation.observedAt > options.nowSeconds) {
    fail("INVALID_TIMESTAMP", "Observation was recorded in the future.");
  }
  if (observation.sourceUpdatedAt > observation.observedAt) {
    fail("INVALID_TIMESTAMP", "Source timestamp is later than the ingestion timestamp.");
  }
  if (observation.sourceChainId !== SOURCE_CHAIN_ID) {
    fail(
      "WRONG_SOURCE_CHAIN",
      `Observation source chain ${observation.sourceChainId} is not Base Mainnet (${SOURCE_CHAIN_ID}).`,
    );
  }
}

/**
 * Validate a persisted ingestion row against the verified feed catalogue and
 * return the core observation shape. A zero feed is accepted only when the
 * caller explicitly identifies a local simulated runtime.
 */
export function validateStoredObservation(
  record: ObservationInsert,
  options: ObservationProvenanceOptions,
): PriceObservation {
  if (record.status !== "valid") {
    fail("INVALID_STATUS", `Observation ${record.assetSymbol}/${record.sourceRoundId} is invalid.`);
  }
  if (record.referencePriceUsdcPerWholeToken === null) {
    fail("INVALID_PRICE", "Observation has no normalized reference price.");
  }

  const sourceKind = isZeroAddress(record.feedAddress) ? "simulated" : "chainlink-coinbase";
  const observation: PriceObservation = {
    assetSymbol: record.assetSymbol,
    priceUsdcPerWholeToken: record.referencePriceUsdcPerWholeToken,
    sourceRoundId: record.sourceRoundId,
    sourceUpdatedAt: record.sourceUpdatedAt,
    observedAt: record.observedAt,
    sourceChainId: record.sourceChainId,
    feedAddress: sourceKind === "simulated" ? null : record.feedAddress,
    sourceKind,
  };
  validateCommon(observation, options);

  if (sourceKind === "simulated") {
    if (options.allowSimulated !== true) {
      fail("SIMULATION_NOT_ALLOWED", "A feedless observation is not allowed in this runtime.");
    }
  } else {
    const feed = expectedFeed(record.assetSymbol, options.feed);
    if (!sameAddress(record.feedAddress, feed.feedAddress)) {
      fail(
        "FEED_MISMATCH",
        `Observation feed does not match the verified feed for ${record.assetSymbol}.`,
      );
    }
    if (record.feedDecimals !== feed.expectedDecimals) {
      fail("DECIMALS_MISMATCH", "Observation feed decimals do not match the verified feed.");
    }
    if (record.sourceDescription !== feed.expectedDescription) {
      fail("DESCRIPTION_MISMATCH", "Observation description does not match the verified feed.");
    }
  }

  if (record.sourceDescription.trim().length === 0) {
    fail("UNKNOWN_PROVENANCE", "Observation has no source description.");
  }

  let normalized: bigint;
  try {
    normalized = normalizeChainlinkAnswer(record.rawAnswer, record.feedDecimals);
  } catch (error) {
    if (error instanceof CoreError) {
      fail(
        error.code === "INVALID_DECIMALS" ? "DECIMALS_MISMATCH" : "INVALID_PRICE",
        error.message,
      );
    }
    throw error;
  }
  if (normalized !== record.referencePriceUsdcPerWholeToken) {
    fail("PRICE_MISMATCH", "Stored reference price does not match the recorded raw feed answer.");
  }

  return observation;
}

/** Recheck provenance when a signed observation is loaded for intent preparation. */
export function assertObservationProvenance(
  observation: PriceObservation,
  options: ObservationProvenanceOptions,
): void {
  validateCommon(observation, options);
  if (observation.sourceKind === "simulated") {
    if (options.allowSimulated !== true || observation.feedAddress !== null) {
      fail("SIMULATION_NOT_ALLOWED", "Simulated provenance is not allowed in this runtime.");
    }
    return;
  }
  if (observation.sourceKind !== "chainlink-coinbase" || observation.feedAddress === null) {
    fail("UNKNOWN_PROVENANCE", "Observation has unknown or incomplete provenance.");
  }
  const feed = expectedFeed(observation.assetSymbol, options.feed);
  if (!sameAddress(observation.feedAddress, feed.feedAddress)) {
    fail(
      "FEED_MISMATCH",
      `Observation feed does not match the verified feed for ${observation.assetSymbol}.`,
    );
  }
}
