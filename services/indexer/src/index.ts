import { decodeEventLog, type Address, type Hex } from "viem";

import {
  DAILY_CLAIMED_EVENT,
  DAILY_CLAIMED_TOPIC,
  TRADE_EVENT,
  TRADE_TOPIC,
  WELCOME_CLAIMED_EVENT,
  WELCOME_CLAIMED_TOPIC,
} from "./abi.js";

export const INDEXER_STREAM = "base-sepolia-core";

export interface IndexerLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly transactionHash: Hex;
  readonly logIndex: number;
}

export interface IndexerBlock {
  readonly number: bigint;
  readonly hash: Hex;
  readonly timestamp: bigint;
}

export interface IndexerClient {
  getBlockNumber(): Promise<bigint>;
  getBlock(input: { blockNumber: bigint }): Promise<IndexerBlock | null>;
  getLogs(input: {
    addresses: readonly Address[];
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<readonly IndexerLog[]>;
}

export interface Checkpoint {
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
}

export interface IndexerStore {
  getCheckpoint(stream: string): Promise<Checkpoint | null>;
  saveCheckpoint(input: {
    stream: string;
    chainId: number;
    blockNumber: bigint;
    blockHash: Hex;
  }): Promise<void>;
  upsertTrade(input: DecodedTrade): Promise<void>;
  upsertClaim(input: DecodedClaim): Promise<void>;
  rewind(chainId: number, blockNumber: bigint): Promise<void>;
}

export interface DecodedTrade {
  readonly chainId: number;
  readonly txHash: Hex;
  readonly logIndex: number;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly blockTime: Date;
  readonly userAddress: Address;
  readonly stockToken: Address;
  readonly assetSymbol: string;
  readonly side: "buy" | "sell";
  readonly usdcAmount: bigint;
  readonly stockAmount: bigint;
  readonly priceUsdcPerWholeToken: bigint;
}

export interface DecodedClaim {
  readonly chainId: number;
  readonly txHash: Hex;
  readonly logIndex: number;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly blockTime: Date;
  readonly userAddress: Address;
  readonly amount: bigint;
  readonly kind: "welcome" | "daily";
}

export interface IndexerOptions {
  readonly chainId: number;
  readonly exchangeAddress: Address;
  readonly settlementAddress: Address;
  /** Lower-case token address to catalogue symbol. */
  readonly symbolByToken: Readonly<Record<string, string>>;
  readonly confirmations?: number;
  readonly chunkSize?: bigint;
  /** Used only when no checkpoint exists. Defaults to latest - 5,000. */
  readonly startBlock?: bigint;
  readonly reorgDepth?: bigint;
}

export interface IndexerSummary {
  readonly fromBlock: bigint | null;
  readonly toBlock: bigint | null;
  readonly trades: number;
  readonly claims: number;
  readonly reorgRewind: bigint | null;
}

const DEFAULT_CONFIRMATIONS = 12;
const DEFAULT_CHUNK_SIZE = 2_000n;
const DEFAULT_REORG_DEPTH = 12n;

function asAddress(value: string): Address {
  return value.toLowerCase() as Address;
}

/** Split an inclusive block range into bounded chunks. */
export function planChunks(
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize: bigint,
): Array<{
  fromBlock: bigint;
  toBlock: bigint;
}> {
  if (chunkSize <= 0n) throw new Error("Indexer chunk size must be positive.");
  if (fromBlock > toBlock) return [];
  const chunks: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = start + chunkSize - 1n;
    chunks.push({ fromBlock: start, toBlock: end > toBlock ? toBlock : end });
  }
  return chunks;
}

function decodeTrade(log: IndexerLog, symbolByToken: Readonly<Record<string, string>>) {
  const decoded = decodeEventLog({
    abi: [TRADE_EVENT],
    eventName: "Trade",
    topics: log.topics as [Hex, ...Hex[]],
    data: log.data,
  });
  const args = decoded.args as unknown as {
    trader: Address;
    stockToken: Address;
    isBuy: boolean;
    usdcAmount: bigint;
    stockAmount: bigint;
    priceUsdcPerWholeToken: bigint;
  };
  const symbol = symbolByToken[args.stockToken.toLowerCase()];
  if (symbol === undefined) {
    throw new Error(`Trade references an unlisted stock token: ${args.stockToken}.`);
  }
  return {
    userAddress: args.trader,
    stockToken: args.stockToken,
    assetSymbol: symbol,
    side: args.isBuy ? ("buy" as const) : ("sell" as const),
    usdcAmount: args.usdcAmount,
    stockAmount: args.stockAmount,
    priceUsdcPerWholeToken: args.priceUsdcPerWholeToken,
  };
}

function decodeClaim(log: IndexerLog) {
  if (log.topics[0]?.toLowerCase() === WELCOME_CLAIMED_TOPIC) {
    const decoded = decodeEventLog({
      abi: [WELCOME_CLAIMED_EVENT],
      eventName: "WelcomeClaimed",
      topics: log.topics as [Hex, ...Hex[]],
      data: log.data,
    });
    const args = decoded.args as unknown as { account: Address; amount: bigint };
    return { userAddress: args.account, amount: args.amount, kind: "welcome" as const };
  }
  if (log.topics[0]?.toLowerCase() === DAILY_CLAIMED_TOPIC) {
    const decoded = decodeEventLog({
      abi: [DAILY_CLAIMED_EVENT],
      eventName: "DailyClaimed",
      topics: log.topics as [Hex, ...Hex[]],
      data: log.data,
    });
    const args = decoded.args as unknown as { account: Address; amount: bigint };
    return { userAddress: args.account, amount: args.amount, kind: "daily" as const };
  }
  return null;
}

/**
 * Process one confirmed range. Checkpoints are written per chunk so a crash or
 * restart resumes near the last processed block instead of rescanning history.
 *
 * Reorg safety: the checkpoint block hash is compared with the canonical block.
 * On mismatch the last `reorgDepth` blocks are deleted and re-indexed.
 */
export async function runIndexerOnce(
  client: IndexerClient,
  store: IndexerStore,
  options: IndexerOptions,
): Promise<IndexerSummary> {
  const confirmations = BigInt(options.confirmations ?? DEFAULT_CONFIRMATIONS);
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const reorgDepth = options.reorgDepth ?? DEFAULT_REORG_DEPTH;
  const latest = await client.getBlockNumber();
  const confirmed = latest > confirmations ? latest - confirmations : 0n;

  const checkpoint = await store.getCheckpoint(INDEXER_STREAM);
  let reorgRewind: bigint | null = null;
  let fromBlock: bigint;

  if (checkpoint !== null) {
    const canonical = await client.getBlock({ blockNumber: checkpoint.blockNumber });
    if (canonical === null) throw new Error("Checkpoint block is not available from the RPC.");
    if (canonical.hash.toLowerCase() !== checkpoint.blockHash.toLowerCase()) {
      const rewindTo =
        checkpoint.blockNumber > reorgDepth ? checkpoint.blockNumber - reorgDepth : 0n;
      await store.rewind(options.chainId, rewindTo);
      reorgRewind = rewindTo;
      fromBlock = rewindTo;
    } else {
      fromBlock = checkpoint.blockNumber + 1n;
    }
  } else if (options.startBlock !== undefined) {
    fromBlock = options.startBlock;
  } else {
    fromBlock = latest > 5_000n ? latest - 5_000n : 0n;
  }

  if (fromBlock > confirmed) {
    return { fromBlock: null, toBlock: null, trades: 0, claims: 0, reorgRewind };
  }

  const blockCache = new Map<string, IndexerBlock>();
  const blockAt = async (blockNumber: bigint): Promise<IndexerBlock> => {
    const key = blockNumber.toString();
    const cached = blockCache.get(key);
    if (cached !== undefined) return cached;
    const block = await client.getBlock({ blockNumber });
    if (block === null) throw new Error(`Block ${blockNumber} is unavailable.`);
    blockCache.set(key, block);
    return block;
  };

  let trades = 0;
  let claims = 0;
  const addresses = [asAddress(options.exchangeAddress), asAddress(options.settlementAddress)];

  for (const chunk of planChunks(fromBlock, confirmed, chunkSize)) {
    const logs = await client.getLogs({
      addresses,
      fromBlock: chunk.fromBlock,
      toBlock: chunk.toBlock,
    });

    for (const log of logs) {
      const block = await blockAt(log.blockNumber);
      const blockTime = new Date(Number(block.timestamp) * 1_000);
      const topic = log.topics[0]?.toLowerCase();
      if (topic === TRADE_TOPIC && asAddress(log.address) === asAddress(options.exchangeAddress)) {
        const trade = decodeTrade(log, options.symbolByToken);
        await store.upsertTrade({
          chainId: options.chainId,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          blockTime,
          ...trade,
        });
        trades += 1;
        continue;
      }
      if (asAddress(log.address) === asAddress(options.settlementAddress)) {
        const claim = decodeClaim(log);
        if (claim !== null) {
          await store.upsertClaim({
            chainId: options.chainId,
            txHash: log.transactionHash,
            logIndex: log.logIndex,
            blockNumber: log.blockNumber,
            blockHash: log.blockHash,
            blockTime,
            ...claim,
          });
          claims += 1;
        }
      }
    }

    const endBlock = await blockAt(chunk.toBlock);
    await store.saveCheckpoint({
      stream: INDEXER_STREAM,
      chainId: options.chainId,
      blockNumber: chunk.toBlock,
      blockHash: endBlock.hash,
    });
  }

  return { fromBlock, toBlock: confirmed, trades, claims, reorgRewind };
}

export * from "./abi.js";
