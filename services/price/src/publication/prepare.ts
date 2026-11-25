import { keccak256 } from "viem";

import { isCoreError, type Address, type PriceBounds } from "@kyrox/core";
import { assertPriceWithinBounds } from "@kyrox/core";
import {
  DeploymentError,
  createPublicationArtifact,
  encodeSetPrice,
  requireAssetAddress,
  requireExchangeAddress,
  type DeploymentManifest,
  type PublicationArtifact,
  type UnsignedTransaction,
} from "@kyrox/protocol";

import type { ObservationInsert, ObservationStore } from "../persistence/types.js";
import { SOURCE_CHAIN_ID } from "../feeds/types.js";
import { validateStoredObservation } from "../provenance.js";

export type PublicationErrorCode =
  | "NOT_A_VALID_OBSERVATION"
  | "INVALID_PRICE"
  | "WRONG_SOURCE_CHAIN"
  | "INVALID_TIMESTAMP"
  | "STALE_OBSERVATION"
  | "FUTURE_TIMESTAMP"
  | "INVALID_ROUND"
  | "INVALID_TOKEN"
  | "DEPLOYMENT_UNAVAILABLE"
  | "DUPLICATE_ROUND"
  | "INVALID_PROVENANCE";

export class PublicationError extends Error {
  override readonly name = "PublicationError";

  constructor(
    readonly code: PublicationErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface PreparedPublication extends UnsignedTransaction {
  readonly exchangeAddress: Address;
  readonly assetSymbol: string;
  readonly stockToken: Address;
  readonly referencePriceUsdcPerWholeToken: bigint;
  readonly sourceRoundId: bigint;
  readonly sourceUpdatedAt: number;
  readonly sourceChainId: typeof SOURCE_CHAIN_ID;
  readonly feedAddress: Address;
  readonly simulated: boolean;
  readonly calldataHash: `0x${string}`;
  readonly artifact: PublicationArtifact;
}

export interface PreparePublicationParams {
  readonly observation: ObservationInsert;
  readonly stockToken: Address;
  readonly manifest: DeploymentManifest | null;
  readonly store?: ObservationStore;
  readonly nowSeconds?: number;
  /** Highest round already known to be published on Sepolia, if tracked externally. */
  readonly lastPublishedRoundId?: bigint;
  /**
   * Defaults to false: production publications must reference a real feed.
   * Local rehearsal may pass true only with a zero feed address.
   */
  readonly simulated?: boolean;
  /** Contract-configured band; when supplied, the observation must satisfy it. */
  readonly priceBounds?: PriceBounds;
  /** Contract-configured freshness window; when supplied, stale rows are refused. */
  readonly maxSourceAgeSeconds?: number;
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * Prepare an unsigned `setPrice` call.
 *
 * Construction only. There is deliberately no signer, wallet client, or
 * submission function in this module; nothing here can move value.
 */
export async function prepareSetPricePublication(
  params: PreparePublicationParams,
): Promise<PreparedPublication> {
  const { observation } = params;
  const nowSeconds = params.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (observation.status !== "valid") {
    throw new PublicationError(
      "NOT_A_VALID_OBSERVATION",
      `Observation ${observation.assetSymbol}/${observation.sourceRoundId} is not valid.`,
    );
  }
  if (
    observation.referencePriceUsdcPerWholeToken === null ||
    observation.referencePriceUsdcPerWholeToken <= 0n
  ) {
    throw new PublicationError("INVALID_PRICE", "Observation has no positive reference price.");
  }
  if (observation.sourceChainId !== SOURCE_CHAIN_ID) {
    throw new PublicationError(
      "WRONG_SOURCE_CHAIN",
      `Observation source chain ${observation.sourceChainId} is not ${SOURCE_CHAIN_ID}.`,
    );
  }
  if (observation.sourceUpdatedAt <= 0) {
    throw new PublicationError("INVALID_TIMESTAMP", "Source timestamp must be positive.");
  }
  if (observation.sourceUpdatedAt > nowSeconds) {
    throw new PublicationError("FUTURE_TIMESTAMP", "Source timestamp is in the future.");
  }
  if (observation.sourceRoundId <= 0n) {
    throw new PublicationError("INVALID_ROUND", "Source round id must be positive.");
  }
  if (params.maxSourceAgeSeconds !== undefined) {
    if (!Number.isInteger(params.maxSourceAgeSeconds) || params.maxSourceAgeSeconds < 0) {
      throw new PublicationError("INVALID_TIMESTAMP", "maxSourceAgeSeconds is invalid.");
    }
    if (nowSeconds - observation.sourceUpdatedAt > params.maxSourceAgeSeconds) {
      throw new PublicationError(
        "STALE_OBSERVATION",
        "Observation is already older than the asset freshness window.",
      );
    }
  }
  if (params.priceBounds !== undefined) {
    try {
      assertPriceWithinBounds(observation.referencePriceUsdcPerWholeToken, params.priceBounds);
    } catch (error) {
      throw new PublicationError(
        "INVALID_PRICE",
        isCoreError(error) ? error.message : "Observation price is outside its band.",
      );
    }
  }
  if (!ADDRESS_PATTERN.test(params.stockToken) || /^0x0{40}$/.test(params.stockToken)) {
    throw new PublicationError("INVALID_TOKEN", "Stock token address is not a valid address.");
  }

  const simulated = params.simulated ?? false;
  try {
    validateStoredObservation(observation, { nowSeconds, allowSimulated: simulated });
  } catch (error) {
    throw new PublicationError(
      "INVALID_PROVENANCE",
      error instanceof Error ? error.message : "Observation provenance is not verified.",
    );
  }

  if (params.manifest === null) {
    throw new PublicationError(
      "DEPLOYMENT_UNAVAILABLE",
      "No Base Sepolia deployment manifest is available; publication is disabled.",
    );
  }

  let exchangeAddress: Address;
  let manifestStockToken: Address;
  try {
    exchangeAddress = requireExchangeAddress(params.manifest);
    manifestStockToken = requireAssetAddress(params.manifest, observation.assetSymbol);
  } catch (error) {
    if (error instanceof DeploymentError) {
      throw new PublicationError("DEPLOYMENT_UNAVAILABLE", error.message);
    }
    throw error;
  }

  if (params.stockToken.toLowerCase() !== manifestStockToken.toLowerCase()) {
    throw new PublicationError(
      "INVALID_TOKEN",
      `Stock token ${params.stockToken} does not match the manifest asset ${manifestStockToken}.`,
    );
  }
  if (simulated && params.manifest.environment !== "local-anvil") {
    throw new PublicationError(
      "INVALID_PROVENANCE",
      "Simulated publication requires an explicit local-anvil manifest.",
    );
  }

  if (
    params.lastPublishedRoundId !== undefined &&
    observation.sourceRoundId <= params.lastPublishedRoundId
  ) {
    throw new PublicationError(
      "DUPLICATE_ROUND",
      `Round ${observation.sourceRoundId} is not newer than ${params.lastPublishedRoundId}.`,
    );
  }
  if (
    params.store !== undefined &&
    (await params.store.isPublished(observation.assetSymbol, observation.sourceRoundId))
  ) {
    throw new PublicationError(
      "DUPLICATE_ROUND",
      `Round ${observation.sourceRoundId} was already prepared for publication.`,
    );
  }

  const transaction = encodeSetPrice(exchangeAddress, {
    stockToken: params.stockToken,
    priceUsdcPerWholeToken: observation.referencePriceUsdcPerWholeToken,
    sourceRoundId: observation.sourceRoundId,
    sourceUpdatedAt: observation.sourceUpdatedAt,
    sourceChainId: observation.sourceChainId,
    feedAddress: observation.feedAddress,
    simulated,
  });

  const calldataHash = keccak256(transaction.data);
  const artifact = createPublicationArtifact({
    exchange: exchangeAddress,
    stockToken: params.stockToken,
    assetSymbol: observation.assetSymbol,
    calldata: transaction.data,
    calldataHash,
    priceUsdcPerWholeToken: observation.referencePriceUsdcPerWholeToken,
    sourceRoundId: observation.sourceRoundId,
    sourceUpdatedAt: observation.sourceUpdatedAt,
    sourceChainId: observation.sourceChainId,
    feedAddress: observation.feedAddress,
    simulated,
  });

  if (params.store !== undefined) {
    await params.store.recordPublication({
      assetSymbol: observation.assetSymbol,
      sourceRoundId: observation.sourceRoundId,
      exchangeAddress,
      calldataHash,
      preparedAt: nowSeconds,
      stockToken: params.stockToken,
      referencePriceUsdcPerWholeToken: observation.referencePriceUsdcPerWholeToken,
      sourceUpdatedAt: observation.sourceUpdatedAt,
      sourceChainId: observation.sourceChainId,
      feedAddress: observation.feedAddress,
      simulated,
      observedAt: observation.observedAt,
      artifactHash: artifact.artifactHash,
      artifactJson: JSON.stringify(artifact),
    });
  }

  return {
    ...transaction,
    exchangeAddress,
    assetSymbol: observation.assetSymbol,
    stockToken: params.stockToken,
    referencePriceUsdcPerWholeToken: observation.referencePriceUsdcPerWholeToken,
    sourceRoundId: observation.sourceRoundId,
    sourceUpdatedAt: observation.sourceUpdatedAt,
    sourceChainId: SOURCE_CHAIN_ID,
    feedAddress: observation.feedAddress,
    simulated,
    calldataHash,
    artifact,
  };
}
