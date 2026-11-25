import { keccak256, decodeEventLog, decodeFunctionData, type Hex } from "viem";

import type { Address } from "@kyrox/core";
import {
  DeploymentError,
  createPublicationArtifact,
  PRICE_SET_EVENT_ABI,
  SET_PRICE_ABI,
  requireAssetAddress,
  requireExchangeAddress,
  type DeploymentManifest,
} from "@kyrox/protocol";

import { assertChainIdentityEvidence, type ChainIdentityEvidence } from "@kyrox/protocol";

import {
  ALLOWED_PUBLICATION_TRANSITIONS,
  type ObservationStore,
  type StoredPublication,
} from "../persistence/types.js";
import type { OnChainObservation, VerificationRpc } from "./types.js";

export type VerificationState =
  "verified" | "included" | "pending" | "unavailable" | "failed" | "mismatch" | "reorged";

export interface VerifyPublicationParams {
  readonly assetSymbol: string;
  readonly sourceRoundId: bigint;
  readonly txHash: Hex;
  readonly manifest: DeploymentManifest;
  readonly store: ObservationStore;
  readonly rpc: VerificationRpc;
  readonly minConfirmations: number;
  /**
   * Production requires an approved base-sepolia manifest and pinned chain
   * identity. Local mode is explicit and must never be selected by a production CLI.
   */
  readonly mode: "production" | "local";
  readonly chainIdentity?: ChainIdentityEvidence;
}

export interface VerificationReport {
  readonly state: VerificationState;
  readonly assetSymbol: string;
  readonly sourceRoundId: string;
  readonly txHash: Hex;
  readonly exchange?: Address;
  readonly stockToken?: Address;
  readonly blockNumber?: string;
  readonly blockHash?: Hex;
  readonly confirmations?: number;
  readonly requiredConfirmations: number;
  readonly checks: readonly string[];
  readonly failures: readonly string[];
  /** True only for transient conditions that should be retried without mutation. */
  readonly retryable: boolean;
  /** True when the canonical receipt and matching PriceSet event prove inclusion. */
  readonly historicalEvidence: boolean;
  /** True when a previously reorged publication is canonical again. */
  readonly canonicalReincluded?: boolean;
}

export class VerificationError extends Error {
  override readonly name = "VerificationError";

  constructor(
    readonly code: "MISSING_RECORD" | "INVALID_MANIFEST" | "WRONG_CHAIN" | "INVALID_INPUT",
    message: string,
  ) {
    super(message);
  }
}

function sameAddress(a: string | null | undefined, b: string): boolean {
  return typeof a === "string" && a.toLowerCase() === b.toLowerCase();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function report(params: {
  readonly request: VerifyPublicationParams;
  readonly stored: StoredPublication;
  readonly state: VerificationState;
  readonly exchange: Address;
  readonly stockToken: Address;
  readonly checks: readonly string[];
  readonly failures: readonly string[];
  readonly retryable?: boolean;
  readonly historicalEvidence?: boolean;
  readonly canonicalReincluded?: boolean;
  readonly blockNumber?: bigint;
  readonly blockHash?: Hex;
  readonly confirmations?: number;
}): VerificationReport {
  return {
    state: params.state,
    assetSymbol: params.stored.assetSymbol,
    sourceRoundId: params.stored.sourceRoundId.toString(),
    txHash: params.request.txHash,
    exchange: params.exchange,
    stockToken: params.stockToken,
    ...(params.blockNumber !== undefined ? { blockNumber: params.blockNumber.toString() } : {}),
    ...(params.blockHash !== undefined ? { blockHash: params.blockHash } : {}),
    ...(params.confirmations !== undefined ? { confirmations: params.confirmations } : {}),
    requiredConfirmations: params.request.minConfirmations,
    checks: params.checks,
    failures: params.failures,
    retryable: params.retryable ?? false,
    historicalEvidence: params.historicalEvidence ?? false,
    ...(params.canonicalReincluded !== undefined
      ? { canonicalReincluded: params.canonicalReincluded }
      : {}),
  };
}

function compareCurrentObservation(
  chain: OnChainObservation,
  stored: StoredPublication,
  blockTimestamp: number,
): string[] {
  const failures: string[] = [];
  if (chain.priceUsdcPerWholeToken !== stored.referencePriceUsdcPerWholeToken) {
    failures.push("current on-chain price does not match the prepared observation");
  }
  if (chain.sourceRoundId !== stored.sourceRoundId) {
    failures.push("current on-chain source round does not match");
  }
  if (chain.sourceUpdatedAt !== stored.sourceUpdatedAt) {
    failures.push("current on-chain source timestamp does not match (possible timestamp rewrite)");
  }
  if (chain.sourceChainId !== stored.sourceChainId) {
    failures.push("current on-chain source chain does not match");
  }
  if (!sameAddress(chain.feedAddress, stored.feedAddress)) {
    failures.push("current on-chain feed address does not match");
  }
  if (chain.simulated !== stored.simulated) {
    failures.push("current on-chain simulated flag does not match");
  }
  if (chain.publishedAt !== blockTimestamp) {
    failures.push("publishedAt does not equal the inclusion block timestamp");
  }
  return failures;
}

function validCurrentObservation(value: OnChainObservation): boolean {
  return (
    typeof value.priceUsdcPerWholeToken === "bigint" &&
    value.priceUsdcPerWholeToken > 0n &&
    typeof value.sourceRoundId === "bigint" &&
    value.sourceRoundId > 0n &&
    Number.isInteger(value.sourceUpdatedAt) &&
    value.sourceUpdatedAt > 0 &&
    Number.isInteger(value.publishedAt) &&
    value.publishedAt > 0 &&
    Number.isInteger(value.sourceChainId) &&
    value.sourceChainId > 0 &&
    typeof value.simulated === "boolean" &&
    /^0x[0-9a-fA-F]{40}$/.test(value.feedAddress)
  );
}

/**
 * Verify an externally submitted `setPrice` transaction.
 *
 * A successful canonical receipt plus matching PriceSet event is historical
 * evidence. A newer current observation does not invalidate an older verified
 * publication. RPC failures are retryable and never mutate the local record.
 *
 * Read-only: this function never signs, sends, or mutates chain state. It may
 * update the local publication lifecycle record.
 */
export async function verifyPublication(
  params: VerifyPublicationParams,
): Promise<VerificationReport> {
  const checks: string[] = [];
  const failures: string[] = [];

  if (!Number.isInteger(params.minConfirmations) || params.minConfirmations < 1) {
    throw new VerificationError(
      "INVALID_INPUT",
      "Confirmation threshold must be a positive integer.",
    );
  }

  const stored = await params.store.getPublication(params.assetSymbol, params.sourceRoundId);
  if (stored === null) {
    throw new VerificationError(
      "MISSING_RECORD",
      `No prepared publication for ${params.assetSymbol} round ${params.sourceRoundId}.`,
    );
  }
  let lifecycleStatus = stored.status;

  let exchange: Address;
  let stockToken: Address;
  try {
    if (params.manifest.assets[params.assetSymbol] === undefined) {
      throw new VerificationError(
        "INVALID_MANIFEST",
        `No token address recorded for ${params.assetSymbol}.`,
      );
    }
    exchange = requireExchangeAddress(params.manifest);
    stockToken = requireAssetAddress(params.manifest, params.assetSymbol);
  } catch (error) {
    if (error instanceof DeploymentError) {
      throw new VerificationError("INVALID_MANIFEST", error.message);
    }
    throw error;
  }
  if (params.mode === "production") {
    if (params.manifest.environment !== "base-sepolia") {
      throw new VerificationError(
        "INVALID_MANIFEST",
        `Production verification requires environment base-sepolia, got "${params.manifest.environment}".`,
      );
    }
    if (params.manifest.status !== "deployed") {
      throw new VerificationError(
        "INVALID_MANIFEST",
        `Production verification requires status deployed, got "${params.manifest.status}".`,
      );
    }
    if (params.chainIdentity === undefined) {
      throw new VerificationError(
        "INVALID_MANIFEST",
        "Production verification requires pinned chain identity evidence.",
      );
    }
    assertChainIdentityEvidence(params.chainIdentity);
  } else if (
    params.manifest.environment !== "local-anvil" ||
    params.manifest.status !== "local-anvil"
  ) {
    throw new VerificationError(
      "INVALID_MANIFEST",
      "Local verification requires an explicit local-anvil manifest.",
    );
  }

  const base = {
    request: params,
    stored,
    exchange,
    stockToken,
    checks,
  };

  let chainId: number;
  try {
    chainId = await params.rpc.getChainId();
  } catch (error) {
    return report({
      ...base,
      state: "unavailable",
      failures: [`RPC chain query is temporarily unavailable: ${errorMessage(error)}`],
      retryable: true,
    });
  }
  if (chainId !== 84_532) {
    throw new VerificationError("WRONG_CHAIN", `RPC chain ${chainId} is not Base Sepolia (84532).`);
  }
  checks.push("RPC chain is 84532");

  if (!sameAddress(stored.exchangeAddress, exchange)) {
    failures.push("prepared exchange does not match the approved manifest");
  }
  if (!sameAddress(stored.stockToken, stockToken)) {
    failures.push("prepared token does not match the approved manifest");
  }

  let receipt: Awaited<ReturnType<VerificationRpc["getTransactionReceipt"]>>;
  try {
    receipt = await params.rpc.getTransactionReceipt(params.txHash);
  } catch (error) {
    return report({
      ...base,
      state: "unavailable",
      failures: [`RPC receipt query is temporarily unavailable: ${errorMessage(error)}`],
      retryable: true,
    });
  }
  if (receipt === null) {
    // A reorged transaction can be pending canonical re-inclusion. Preserve
    // that state until a canonical receipt is available again.
    if (
      stored.status !== "verified" &&
      stored.status !== "reorged" &&
      stored.status !== "failed" &&
      stored.status !== "verification_failed" &&
      stored.status !== "submitted"
    ) {
      await params.store.updatePublication({
        assetSymbol: params.assetSymbol,
        sourceRoundId: params.sourceRoundId,
        status: "submitted",
        transactionHash: params.txHash,
      });
    }
    return report({
      ...base,
      state: "pending",
      failures: [
        stored.status === "reorged"
          ? "canonical receipt is not available yet; awaiting re-inclusion"
          : "transaction receipt is not available yet",
      ],
      retryable: true,
    });
  }

  let headNumber: bigint;
  try {
    headNumber = await params.rpc.getBlockNumber();
  } catch (error) {
    return report({
      ...base,
      state: "unavailable",
      failures: [`RPC head query is temporarily unavailable: ${errorMessage(error)}`],
      retryable: true,
    });
  }
  if (receipt.blockNumber > headNumber) {
    return report({
      ...base,
      state: "unavailable",
      failures: ["RPC returned a receipt ahead of its canonical head; retry required"],
      retryable: true,
    });
  }
  const confirmations = Number(headNumber - receipt.blockNumber) + 1;

  if (receipt.status === "reverted") {
    if (
      stored.status !== "verified" &&
      stored.status !== "reorged" &&
      stored.status !== "failed" &&
      stored.status !== "verification_failed"
    ) {
      await params.store.updatePublication({
        assetSymbol: params.assetSymbol,
        sourceRoundId: params.sourceRoundId,
        status: "failed",
        transactionHash: params.txHash,
        blockNumber: receipt.blockNumber.toString(),
        blockHash: receipt.blockHash,
        confirmations,
        failureReason: "transaction reverted",
      });
    }
    return report({
      ...base,
      state: "failed",
      failures: ["transaction reverted"],
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      confirmations,
    });
  }
  checks.push("transaction executed successfully");

  let block: { timestamp: number; hash: Hex };
  try {
    block = await params.rpc.getBlock(receipt.blockNumber);
  } catch (error) {
    return report({
      ...base,
      state: "unavailable",
      failures: [`RPC inclusion block query is temporarily unavailable: ${errorMessage(error)}`],
      retryable: true,
    });
  }
  if (block.hash !== receipt.blockHash) {
    return report({
      ...base,
      state: "unavailable",
      failures: ["RPC receipt and canonical block hashes disagree; retry required"],
      retryable: true,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      confirmations,
    });
  }

  const confirmationDepthReorg =
    stored.status === "reorged" && stored.failureReason?.includes("confirmation depth") === true;
  const reinclusionPending =
    stored.status === "reorged" && stored.failureReason?.includes("re-inclusion") === true;
  const blockHashChanged = stored.blockHash !== undefined && stored.blockHash !== receipt.blockHash;
  const canonicalReincluded =
    stored.status === "reorged" ||
    (blockHashChanged && ALLOWED_PUBLICATION_TRANSITIONS[stored.status].includes("reorged"));

  if (blockHashChanged) {
    checks.push("previous inclusion block hash changed; the prior inclusion was reorged");
    if (stored.status !== "reorged") {
      if (!ALLOWED_PUBLICATION_TRANSITIONS[stored.status].includes("reorged")) {
        return report({
          ...base,
          state: "mismatch",
          failures: ["a terminal publication record cannot be re-included"],
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          confirmations,
        });
      }
      await params.store.updatePublication({
        assetSymbol: params.assetSymbol,
        sourceRoundId: params.sourceRoundId,
        status: "reorged",
        transactionHash: params.txHash,
        blockHash: receipt.blockHash,
        confirmations,
        invalidatedAt: block.timestamp,
        failureReason: "inclusion block hash changed; canonical re-inclusion candidate",
      });
      lifecycleStatus = "reorged";
    }
  } else if (stored.status === "reorged" && !confirmationDepthReorg && !reinclusionPending) {
    return report({
      ...base,
      state: "reorged",
      failures: ["the previously reorged receipt is not canonical again yet"],
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      confirmations,
    });
  }

  const historicalFailures: string[] = [...failures];
  const addHistoricalFailure = (message: string): void => {
    failures.push(message);
    historicalFailures.push(message);
  };

  if (!sameAddress(receipt.to, exchange)) {
    addHistoricalFailure("transaction destination is not the approved exchange");
  } else {
    checks.push("transaction destination matches the exchange");
  }

  let transaction: Awaited<ReturnType<VerificationRpc["getTransaction"]>>;
  try {
    transaction = await params.rpc.getTransaction(params.txHash);
  } catch (error) {
    return report({
      ...base,
      state: "unavailable",
      failures: [`RPC transaction query is temporarily unavailable: ${errorMessage(error)}`],
      retryable: true,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      confirmations,
    });
  }
  if (transaction === null) {
    return report({
      ...base,
      state: "unavailable",
      failures: ["transaction body is temporarily unavailable; retry required"],
      retryable: true,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      confirmations,
    });
  }
  if (!sameAddress(transaction.to, exchange)) {
    addHistoricalFailure("transaction body destination is not the approved exchange");
  }
  if (transaction.input === "0x") {
    addHistoricalFailure("transaction has no calldata");
  } else {
    const calldataHash = keccak256(transaction.input);
    if (calldataHash !== stored.calldataHash) {
      addHistoricalFailure("calldata hash does not match the prepared publication");
    } else {
      checks.push("calldata hash matches the prepared publication");
      if (stored.artifactHash.length > 0) {
        const expectedArtifact = createPublicationArtifact({
          exchange,
          stockToken,
          assetSymbol: stored.assetSymbol,
          calldata: transaction.input,
          calldataHash: stored.calldataHash as `0x${string}`,
          priceUsdcPerWholeToken: stored.referencePriceUsdcPerWholeToken,
          sourceRoundId: stored.sourceRoundId,
          sourceUpdatedAt: stored.sourceUpdatedAt,
          sourceChainId: stored.sourceChainId,
          feedAddress: stored.feedAddress,
          simulated: stored.simulated,
        });
        if (expectedArtifact.artifactHash !== stored.artifactHash) {
          addHistoricalFailure("publication artifact hash does not match the prepared snapshot");
        } else {
          checks.push("publication artifact hash matches");
        }
      }
    }

    try {
      const decoded = decodeFunctionData({ abi: SET_PRICE_ABI, data: transaction.input });
      if (decoded.functionName !== "setPrice") {
        addHistoricalFailure("transaction is not a setPrice call");
      } else {
        const args = decoded.args as readonly [
          Address,
          bigint,
          bigint,
          bigint,
          bigint,
          Address,
          boolean,
        ];
        if (!sameAddress(args[0], stockToken)) {
          addHistoricalFailure("calldata token does not match the approved asset");
        }
        if (args[1] !== stored.referencePriceUsdcPerWholeToken) {
          addHistoricalFailure("calldata price does not match the prepared observation");
        }
        if (args[2] !== stored.sourceRoundId) {
          addHistoricalFailure("calldata round does not match the prepared observation");
        }
        if (Number(args[3]) !== stored.sourceUpdatedAt) {
          addHistoricalFailure("calldata source timestamp does not match");
        }
        if (Number(args[4]) !== stored.sourceChainId) {
          addHistoricalFailure("calldata source chain does not match");
        }
        if (!sameAddress(args[5], stored.feedAddress)) {
          addHistoricalFailure("calldata feed address does not match");
        }
        if (args[6] !== stored.simulated) {
          addHistoricalFailure("calldata simulated flag does not match");
        }
      }
    } catch {
      addHistoricalFailure("calldata cannot be decoded as setPrice");
    }
  }

  // Select the event for this exact token/round rather than the first PriceSet
  // log. This matched event is the historical inclusion evidence.
  let priceSetArgs: {
    stockToken: Address;
    priceUsdcPerWholeToken: bigint;
    sourceRoundId: bigint;
    sourceUpdatedAt: bigint;
    sourceChainId: bigint;
    feedAddress: Address;
    simulated: boolean;
    publishedAt: bigint;
  } | null = null;
  let sawPriceSet = false;
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, exchange)) continue;
    try {
      const decoded = decodeEventLog({
        abi: PRICE_SET_EVENT_ABI,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (decoded.eventName !== "PriceSet") continue;
      sawPriceSet = true;
      const args = decoded.args as unknown as {
        stockToken: Address;
        priceUsdcPerWholeToken: bigint;
        sourceRoundId: bigint;
        sourceUpdatedAt: bigint;
        sourceChainId: bigint;
        feedAddress: Address;
        simulated: boolean;
        publishedAt: bigint;
      };
      if (sameAddress(args.stockToken, stockToken) && args.sourceRoundId === stored.sourceRoundId) {
        priceSetArgs = args;
        break;
      }
    } catch {
      // Not a PriceSet log.
    }
  }
  if (priceSetArgs === null) {
    addHistoricalFailure(
      sawPriceSet
        ? "no PriceSet event matched the prepared token and round"
        : "no PriceSet event was emitted by the exchange",
    );
  } else {
    checks.push("matching PriceSet event found");
    if (!sameAddress(priceSetArgs.stockToken, stockToken))
      addHistoricalFailure("event token mismatch");
    if (priceSetArgs.priceUsdcPerWholeToken !== stored.referencePriceUsdcPerWholeToken) {
      addHistoricalFailure("event price mismatch");
    }
    if (priceSetArgs.sourceRoundId !== stored.sourceRoundId)
      addHistoricalFailure("event round mismatch");
    if (Number(priceSetArgs.sourceUpdatedAt) !== stored.sourceUpdatedAt) {
      addHistoricalFailure("event source timestamp mismatch");
    }
    if (Number(priceSetArgs.sourceChainId) !== stored.sourceChainId) {
      addHistoricalFailure("event source chain mismatch");
    }
    if (!sameAddress(priceSetArgs.feedAddress, stored.feedAddress)) {
      addHistoricalFailure("event feed mismatch");
    }
    if (priceSetArgs.simulated !== stored.simulated)
      addHistoricalFailure("event simulated flag mismatch");
    if (Number(priceSetArgs.publishedAt) !== block.timestamp) {
      addHistoricalFailure("event publishedAt does not equal the inclusion block timestamp");
    }
  }

  const historicalEvidence = historicalFailures.length === 0;
  let observation: OnChainObservation;
  try {
    observation = await params.rpc.readObservation(exchange, stockToken, headNumber);
  } catch (error) {
    return report({
      ...base,
      state: "unavailable",
      failures: [`RPC observation query is temporarily unavailable: ${errorMessage(error)}`],
      retryable: true,
      historicalEvidence,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      confirmations,
    });
  }

  if (!validCurrentObservation(observation)) {
    failures.push("exchange returned a malformed current observation");
  } else if (observation.sourceRoundId > stored.sourceRoundId) {
    checks.push(
      "newer canonical observation present; historical receipt and PriceSet remain valid evidence",
    );
  } else if (observation.sourceRoundId < stored.sourceRoundId) {
    failures.push("canonical observation round regressed below the historically published round");
    if (historicalEvidence) {
      if (
        lifecycleStatus !== "reorged" &&
        ALLOWED_PUBLICATION_TRANSITIONS[lifecycleStatus].includes("reorged")
      ) {
        await params.store.updatePublication({
          assetSymbol: params.assetSymbol,
          sourceRoundId: params.sourceRoundId,
          status: "reorged",
          transactionHash: params.txHash,
          blockHash: receipt.blockHash,
          confirmations,
          invalidatedAt: block.timestamp,
          failureReason: "canonical observation regressed (reorg)",
        });
      }
      return report({
        ...base,
        state: "reorged",
        failures,
        historicalEvidence: true,
        canonicalReincluded,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        confirmations,
      });
    }
  } else {
    failures.push(...compareCurrentObservation(observation, stored, block.timestamp));
  }

  if (failures.length > 0) {
    if (lifecycleStatus !== "verified" && lifecycleStatus !== "reorged") {
      await params.store.updatePublication({
        assetSymbol: params.assetSymbol,
        sourceRoundId: params.sourceRoundId,
        status: "verification_failed",
        transactionHash: params.txHash,
        blockNumber: receipt.blockNumber.toString(),
        blockHash: receipt.blockHash,
        confirmations,
        failureReason: failures.join("; "),
      });
    }
    return report({
      ...base,
      state: "mismatch",
      failures,
      historicalEvidence,
      canonicalReincluded,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      confirmations,
    });
  }

  if (confirmations < params.minConfirmations) {
    if (lifecycleStatus === "verified") {
      await params.store.updatePublication({
        assetSymbol: params.assetSymbol,
        sourceRoundId: params.sourceRoundId,
        status: "reorged",
        transactionHash: params.txHash,
        blockHash: receipt.blockHash,
        confirmations,
        invalidatedAt: block.timestamp,
        failureReason: "canonical confirmation depth fell below the verified threshold",
      });
      return report({
        ...base,
        state: "reorged",
        failures: [
          `confirmations ${confirmations} fell below the verified threshold ${params.minConfirmations}`,
        ],
        historicalEvidence: true,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        confirmations,
      });
    }
    if (lifecycleStatus !== "reorged") {
      await params.store.updatePublication({
        assetSymbol: params.assetSymbol,
        sourceRoundId: params.sourceRoundId,
        status: "included",
        transactionHash: params.txHash,
        blockNumber: receipt.blockNumber.toString(),
        blockHash: receipt.blockHash,
        confirmations,
        includedAt: block.timestamp,
      });
    }
    return report({
      ...base,
      state: "included",
      failures: [
        `confirmations ${confirmations} are below the required ${params.minConfirmations}`,
      ],
      retryable: true,
      historicalEvidence: true,
      canonicalReincluded,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      confirmations,
    });
  }

  checks.push(`confirmations ${confirmations} meet the threshold`);
  if (canonicalReincluded) checks.push("previously reorged publication canonically re-included");
  await params.store.updatePublication({
    assetSymbol: params.assetSymbol,
    sourceRoundId: params.sourceRoundId,
    status: "verified",
    transactionHash: params.txHash,
    blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash,
    confirmations,
    includedAt: block.timestamp,
    verifiedAt: block.timestamp,
  });

  return report({
    ...base,
    state: "verified",
    failures: [],
    historicalEvidence: true,
    canonicalReincluded,
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
    confirmations,
  });
}
