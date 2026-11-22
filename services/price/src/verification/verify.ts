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

import type { ObservationStore, StoredPublication } from "../persistence/types.js";
import type { OnChainObservation, VerificationRpc } from "./types.js";

export type VerificationState =
  "verified" | "included" | "pending" | "failed" | "mismatch" | "reorged";

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
  readonly blockHash?: string;
  readonly confirmations?: number;
  readonly requiredConfirmations: number;
  readonly checks: readonly string[];
  readonly failures: readonly string[];
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

function compareObservation(
  chain: OnChainObservation,
  stored: StoredPublication,
  blockTimestamp: number,
): string[] {
  const failures: string[] = [];
  if (chain.priceUsdcPerWholeToken !== stored.referencePriceUsdcPerWholeToken) {
    failures.push("on-chain price does not match the prepared observation");
  }
  if (chain.sourceRoundId !== stored.sourceRoundId) {
    failures.push("on-chain source round does not match");
  }
  if (chain.sourceUpdatedAt !== stored.sourceUpdatedAt) {
    failures.push("on-chain source timestamp does not match (possible timestamp rewrite)");
  }
  if (chain.sourceChainId !== stored.sourceChainId) {
    failures.push("on-chain source chain does not match");
  }
  if (!sameAddress(chain.feedAddress, stored.feedAddress)) {
    failures.push("on-chain feed address does not match");
  }
  if (chain.simulated !== stored.simulated) {
    failures.push("on-chain simulated flag does not match");
  }
  if (chain.publishedAt !== blockTimestamp) {
    failures.push("publishedAt does not equal the inclusion block timestamp");
  }
  return failures;
}

/**
 * Verify an externally submitted `setPrice` transaction.
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
  } else {
    if (params.manifest.environment !== "local-anvil" || params.manifest.status !== "local-anvil") {
      throw new VerificationError(
        "INVALID_MANIFEST",
        "Local verification requires an explicit local-anvil manifest.",
      );
    }
  }

  const chainId = await params.rpc.getChainId();
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

  const receipt = await params.rpc.getTransactionReceipt(params.txHash);
  if (receipt === null) {
    if (stored.status !== "verified") {
      await params.store.updatePublication({
        assetSymbol: params.assetSymbol,
        sourceRoundId: params.sourceRoundId,
        status: "submitted",
        transactionHash: params.txHash,
      });
    }
    return {
      state: "pending",
      assetSymbol: params.assetSymbol,
      sourceRoundId: params.sourceRoundId.toString(),
      txHash: params.txHash,
      exchange,
      stockToken,
      requiredConfirmations: params.minConfirmations,
      checks,
      failures: ["transaction receipt is not available yet"],
    };
  }

  const confirmations = Number((await params.rpc.getBlockNumber()) - receipt.blockNumber) + 1;

  if (receipt.status === "reverted") {
    if (stored.status === "verified") {
      return {
        state: "failed",
        assetSymbol: params.assetSymbol,
        sourceRoundId: params.sourceRoundId.toString(),
        txHash: params.txHash,
        exchange,
        stockToken,
        blockNumber: receipt.blockNumber.toString(),
        blockHash: receipt.blockHash,
        confirmations,
        requiredConfirmations: params.minConfirmations,
        checks,
        failures: [
          "transaction reverted after being previously verified; canonical block hash unchanged",
        ],
      };
    }
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
    return {
      state: "failed",
      assetSymbol: params.assetSymbol,
      sourceRoundId: params.sourceRoundId.toString(),
      txHash: params.txHash,
      exchange,
      stockToken,
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
      confirmations,
      requiredConfirmations: params.minConfirmations,
      checks,
      failures: ["transaction reverted"],
    };
  }
  checks.push("transaction executed successfully");
  const block = await params.rpc.getBlock(receipt.blockNumber);

  if (stored.blockHash !== undefined && stored.blockHash !== receipt.blockHash) {
    await params.store.updatePublication({
      assetSymbol: params.assetSymbol,
      sourceRoundId: params.sourceRoundId,
      status: "reorged",
      transactionHash: params.txHash,
      blockHash: receipt.blockHash,
      confirmations,
      invalidatedAt: block.timestamp,
      failureReason: "inclusion block hash changed (reorg)",
    });
    return {
      state: "reorged",
      assetSymbol: params.assetSymbol,
      sourceRoundId: params.sourceRoundId.toString(),
      txHash: params.txHash,
      exchange,
      stockToken,
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
      confirmations,
      requiredConfirmations: params.minConfirmations,
      checks,
      failures: ["inclusion block hash changed; the previous inclusion was reorged"],
    };
  }

  if (!sameAddress(receipt.to, exchange)) {
    failures.push("transaction destination is not the approved exchange");
  } else {
    checks.push("transaction destination matches the exchange");
  }

  const transaction = await params.rpc.getTransaction(params.txHash);
  if (transaction === null) {
    failures.push("transaction body is unavailable");
  } else if (transaction.input === "0x") {
    failures.push("transaction has no calldata");
  } else {
    const calldataHash = keccak256(transaction.input);
    if (calldataHash !== stored.calldataHash) {
      failures.push("calldata hash does not match the prepared publication");
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
          failures.push("publication artifact hash does not match the prepared snapshot");
        } else {
          checks.push("publication artifact hash matches");
        }
      }
    }

    try {
      const decoded = decodeFunctionData({ abi: SET_PRICE_ABI, data: transaction.input });
      if (decoded.functionName !== "setPrice") {
        failures.push("transaction is not a setPrice call");
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
          failures.push("calldata token does not match the approved asset");
        }
        if (args[1] !== stored.referencePriceUsdcPerWholeToken) {
          failures.push("calldata price does not match the prepared observation");
        }
        if (args[2] !== stored.sourceRoundId) {
          failures.push("calldata round does not match the prepared observation");
        }
        if (Number(args[3]) !== stored.sourceUpdatedAt) {
          failures.push("calldata source timestamp does not match");
        }
        if (Number(args[4]) !== stored.sourceChainId) {
          failures.push("calldata source chain does not match");
        }
        if (!sameAddress(args[5], stored.feedAddress)) {
          failures.push("calldata feed address does not match");
        }
        if (args[6] !== stored.simulated) {
          failures.push("calldata simulated flag does not match");
        }
      }
    } catch {
      failures.push("calldata cannot be decoded as setPrice");
    }
  }

  // Deterministic event lookup: decode every log from the exchange and keep PriceSet.
  let priceSetArgs: readonly unknown[] | null = null;
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, exchange)) continue;
    try {
      const decoded = decodeEventLog({
        abi: PRICE_SET_EVENT_ABI,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (decoded.eventName === "PriceSet") {
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
        priceSetArgs = [
          args.stockToken,
          args.priceUsdcPerWholeToken,
          args.sourceRoundId,
          args.sourceUpdatedAt,
          args.sourceChainId,
          args.feedAddress,
          args.simulated,
          args.publishedAt,
        ];
        break;
      }
    } catch {
      // Not a PriceSet log.
    }
  }
  if (priceSetArgs === null) {
    failures.push("no PriceSet event was emitted by the exchange");
  } else {
    checks.push("PriceSet event found");
    const [
      eventToken,
      eventPrice,
      eventRound,
      eventUpdatedAt,
      eventChain,
      eventFeed,
      eventSimulated,
      eventPublishedAt,
    ] = priceSetArgs as [Address, bigint, bigint, bigint, bigint, Address, boolean, bigint];
    if (!sameAddress(eventToken, stockToken)) failures.push("event token mismatch");
    if (eventPrice !== stored.referencePriceUsdcPerWholeToken)
      failures.push("event price mismatch");
    if (eventRound !== stored.sourceRoundId) failures.push("event round mismatch");
    if (Number(eventUpdatedAt) !== stored.sourceUpdatedAt)
      failures.push("event source timestamp mismatch");
    if (Number(eventChain) !== stored.sourceChainId) failures.push("event source chain mismatch");
    if (!sameAddress(eventFeed, stored.feedAddress)) failures.push("event feed mismatch");
    if (eventSimulated !== stored.simulated) failures.push("event simulated flag mismatch");
    if (Number(eventPublishedAt) !== block.timestamp) {
      failures.push("event publishedAt does not equal the inclusion block timestamp");
    }
  }

  const observation = await params.rpc.readObservation(exchange, stockToken);
  failures.push(...compareObservation(observation, stored, block.timestamp));

  if (failures.length > 0) {
    if (stored.status === "verified") {
      return {
        state: "mismatch",
        assetSymbol: params.assetSymbol,
        sourceRoundId: params.sourceRoundId.toString(),
        txHash: params.txHash,
        exchange,
        stockToken,
        blockNumber: receipt.blockNumber.toString(),
        blockHash: receipt.blockHash,
        confirmations,
        requiredConfirmations: params.minConfirmations,
        checks,
        failures,
      };
    }
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
    return {
      state: "mismatch",
      assetSymbol: params.assetSymbol,
      sourceRoundId: params.sourceRoundId.toString(),
      txHash: params.txHash,
      exchange,
      stockToken,
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
      confirmations,
      requiredConfirmations: params.minConfirmations,
      checks,
      failures,
    };
  }

  if (confirmations < params.minConfirmations) {
    if (stored.status === "verified") {
      return {
        state: "verified",
        assetSymbol: params.assetSymbol,
        sourceRoundId: params.sourceRoundId.toString(),
        txHash: params.txHash,
        exchange,
        stockToken,
        blockNumber: receipt.blockNumber.toString(),
        blockHash: receipt.blockHash,
        confirmations,
        requiredConfirmations: params.minConfirmations,
        checks,
        failures: [],
      };
    }
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
    return {
      state: "included",
      assetSymbol: params.assetSymbol,
      sourceRoundId: params.sourceRoundId.toString(),
      txHash: params.txHash,
      exchange,
      stockToken,
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
      confirmations,
      requiredConfirmations: params.minConfirmations,
      checks,
      failures: [
        `confirmations ${confirmations} are below the required ${params.minConfirmations}`,
      ],
    };
  }

  checks.push(`confirmations ${confirmations} meet the threshold`);
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

  return {
    state: "verified",
    assetSymbol: params.assetSymbol,
    sourceRoundId: params.sourceRoundId.toString(),
    txHash: params.txHash,
    exchange,
    stockToken,
    blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash,
    confirmations,
    requiredConfirmations: params.minConfirmations,
    checks,
    failures: [],
  };
}
