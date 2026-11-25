import type { Address } from "@kyrox/core";
import type { Hex } from "viem";

export interface ReceiptLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
}

export interface TransactionReceipt {
  readonly status: "success" | "reverted";
  readonly to: Address | null;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly logs: readonly ReceiptLog[];
}

export interface TransactionData {
  readonly to: Address | null;
  readonly input: Hex;
}

export interface OnChainObservation {
  readonly priceUsdcPerWholeToken: bigint;
  readonly sourceRoundId: bigint;
  readonly sourceUpdatedAt: number;
  readonly publishedAt: number;
  readonly sourceChainId: number;
  readonly feedAddress: Address;
  readonly simulated: boolean;
}

/** Read-only RPC surface used by verification. No wallet actions exist here. */
export interface VerificationRpc {
  getChainId(): Promise<number>;
  getTransactionReceipt(txHash: Hex): Promise<TransactionReceipt | null>;
  getTransaction(txHash: Hex): Promise<TransactionData | null>;
  getBlockNumber(): Promise<bigint>;
  getBlock(blockNumber: bigint): Promise<{ timestamp: number; hash: Hex }>;
  readObservation(
    exchange: Address,
    token: Address,
    blockNumber?: bigint,
  ): Promise<OnChainObservation>;
}
