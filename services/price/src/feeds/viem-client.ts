import {
  TransactionReceiptNotFoundError,
  createPublicClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { base } from "viem/chains";

import { ERC20_METADATA_ABI, KYROX_EXCHANGE_ABI } from "@kyrox/protocol";

import type { VerificationRpc } from "../verification/types.js";

import type { EvmReadClient, LatestRoundData } from "./types.js";

const CHAINLINK_AGGREGATOR_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "description",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

/**
 * viem-backed implementation of the read-only client.
 *
 * The chain is pinned to Base Mainnet. No private key, account, or wallet client
 * is constructed anywhere in this service.
 */
export function createBaseMainnetReadClient(rpcUrl: string): EvmReadClient {
  if (!rpcUrl.trim()) {
    throw new Error("BASE_MAINNET_RPC_URL is required for price ingestion.");
  }
  const client = createPublicClient({
    chain: base,
    transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }),
  });

  return {
    async getChainId() {
      return client.getChainId();
    },
    async getBytecode(address) {
      return client.getBytecode({ address });
    },
    async readDecimals(address) {
      return client.readContract({
        address,
        abi: CHAINLINK_AGGREGATOR_ABI,
        functionName: "decimals",
      });
    },
    async readDescription(address) {
      return client.readContract({
        address,
        abi: CHAINLINK_AGGREGATOR_ABI,
        functionName: "description",
      });
    },
    async readLatestRoundData(address): Promise<LatestRoundData> {
      const [roundId, answer, startedAt, updatedAt, answeredInRound] = await client.readContract({
        address,
        abi: CHAINLINK_AGGREGATOR_ABI,
        functionName: "latestRoundData",
      });
      return { roundId, answer, startedAt, updatedAt, answeredInRound };
    },
  };
}

/** Read token decimals on Base Sepolia. Used only by intent preparation. */
export interface SepoliaChainReader {
  getChainId(): Promise<number>;
  getTokenDecimals(token: Address): Promise<number>;
}

export function createBaseSepoliaReadClient(rpcUrl: string): SepoliaChainReader {
  if (!rpcUrl.trim()) {
    throw new Error("BASE_SEPOLIA_RPC_URL is required for intent preparation.");
  }
  const client = createPublicClient({
    chain: {
      id: 84_532,
      name: "Base Sepolia",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    },
    transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }),
  });

  return {
    getChainId: () => client.getChainId(),
    getTokenDecimals: (token) =>
      client.readContract({
        address: token,
        abi: ERC20_METADATA_ABI,
        functionName: "decimals",
      }),
  };
}

/** Read-only Base Sepolia client used by publication verification. */
export function createSepoliaVerificationClient(rpcUrl: string): VerificationRpc {
  if (!rpcUrl.trim()) {
    throw new Error("BASE_SEPOLIA_RPC_URL is required for publication verification.");
  }
  const client = createPublicClient({
    chain: {
      id: 84_532,
      name: "Base Sepolia",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    },
    transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }),
  });

  return {
    getChainId: () => client.getChainId(),
    async getTransactionReceipt(txHash: Hex) {
      try {
        const receipt = await client.getTransactionReceipt({ hash: txHash });
        return {
          status: receipt.status,
          to: receipt.to,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          logs: receipt.logs.map((log) => ({
            address: log.address,
            topics: log.topics,
            data: log.data,
          })),
        };
      } catch (error) {
        if (error instanceof TransactionReceiptNotFoundError) return null;
        throw error;
      }
    },
    async getTransaction(txHash: Hex) {
      const tx = await client.getTransaction({ hash: txHash });
      return { to: tx.to, input: tx.input };
    },
    getBlockNumber: () => client.getBlockNumber(),
    async getBlock(blockNumber: bigint) {
      const block = await client.getBlock({ blockNumber });
      return { timestamp: Number(block.timestamp), hash: block.hash };
    },
    async readObservation(exchange: Address, token: Address, blockNumber?: bigint) {
      const [price, roundId, sourceUpdatedAt, publishedAt, sourceChainId, feedAddress, simulated] =
        await client.readContract({
          address: exchange,
          abi: KYROX_EXCHANGE_ABI,
          functionName: "observation",
          args: [token],
          ...(blockNumber !== undefined ? { blockNumber } : {}),
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
