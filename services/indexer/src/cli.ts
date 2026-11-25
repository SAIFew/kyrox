import { createDatabase } from "@kyrox/db";
import { TESTNET_ASSETS, type Address as CoreAddress } from "@kyrox/core";
import {
  loadDeploymentManifest,
  requireAssetAddress,
  requireExchangeAddress,
} from "@kyrox/protocol";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { baseSepolia } from "viem/chains";

import { runIndexerOnce, type IndexerClient, type IndexerLog } from "./index.js";
import { createPostgresIndexerStore } from "./store.js";

const DEFAULT_MANIFEST = "deployments/base-sepolia.json";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required to run the indexer.`);
  }
  return value;
}

function positiveInteger(name: string, fallback?: number): number | undefined {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw.length === 0) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function optionalBigInt(name: string): bigint | undefined {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw.length === 0) return undefined;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a non-negative integer block.`);
  return BigInt(raw);
}

async function main(): Promise<void> {
  const rpcUrl = required("BASE_SEPOLIA_RPC_URL");
  const databaseUrl = required("DATABASE_URL");
  const manifestPath = process.env["KYROX_DEPLOYMENT_MANIFEST"]?.trim() || DEFAULT_MANIFEST;
  const manifest = loadDeploymentManifest(manifestPath);

  if (manifest.chainId !== 84_532) {
    throw new Error(`Indexer requires Base Sepolia (84532); manifest says ${manifest.chainId}.`);
  }
  const exchangeAddress = requireExchangeAddress(manifest, "KyroxExchange") as Address;
  const settlementAddress = requireExchangeAddress(manifest, "TestUSDC") as Address;

  const symbolByToken: Record<string, string> = {};
  for (const asset of TESTNET_ASSETS) {
    const address = requireAssetAddress(manifest, asset.symbol) as CoreAddress;
    symbolByToken[address.toLowerCase()] = asset.symbol;
  }

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const client: IndexerClient = {
    async getBlockNumber() {
      return publicClient.getBlockNumber();
    },
    async getBlock({ blockNumber }) {
      const block = await publicClient.getBlock({ blockNumber });
      if (block.hash === null) return null;
      return { number: block.number, hash: block.hash, timestamp: block.timestamp };
    },
    async getLogs({ addresses, fromBlock, toBlock }) {
      const logs = await publicClient.getLogs({
        address: [...addresses],
        fromBlock,
        toBlock,
      });
      const mapped: IndexerLog[] = [];
      for (const log of logs) {
        if (
          log.blockNumber === null ||
          log.blockHash === null ||
          log.transactionHash === null ||
          log.logIndex === null
        ) {
          continue;
        }
        mapped.push({
          address: log.address,
          topics: log.topics as readonly Hex[],
          data: log.data,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          transactionHash: log.transactionHash,
          logIndex: log.logIndex,
        });
      }
      return mapped;
    },
  };

  const database = createDatabase(databaseUrl);
  const store = createPostgresIndexerStore(database.db);
  const confirmations = positiveInteger("INDEXER_CONFIRMATIONS", 12) ?? 12;
  const chunkSize = BigInt(positiveInteger("INDEXER_CHUNK_SIZE", 2_000) ?? 2_000);
  const reorgDepth = BigInt(positiveInteger("INDEXER_REORG_DEPTH", 12) ?? 12);
  const startBlock = optionalBigInt("INDEXER_START_BLOCK");
  const once = process.env["INDEXER_ONCE"]?.trim() === "1";
  const intervalMs = positiveInteger("INDEXER_INTERVAL_MS", 15_000) ?? 15_000;

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    do {
      try {
        const summary = await runIndexerOnce(client, store, {
          chainId: 84_532,
          exchangeAddress,
          settlementAddress,
          symbolByToken,
          confirmations,
          chunkSize,
          reorgDepth,
          ...(startBlock === undefined ? {} : { startBlock }),
        });
        console.log(JSON.stringify({ event: "indexer_cycle", ...summary }));
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "indexer_cycle_failed",
            message: error instanceof Error ? error.message : "unknown error",
          }),
        );
        if (once) throw error;
      }
      if (once) break;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    } while (!stopping);
  } finally {
    await database.pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
