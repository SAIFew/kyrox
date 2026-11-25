import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from "viem";

import {
  DAILY_CLAIMED_EVENT,
  TRADE_EVENT,
  WELCOME_CLAIMED_EVENT,
  runIndexerOnce,
  type Checkpoint,
  type DecodedClaim,
  type DecodedTrade,
  type IndexerBlock,
  type IndexerClient,
  type IndexerLog,
  type IndexerStore,
} from "../src/index.js";

const EXCHANGE = "0x1111111111111111111111111111111111111111" as Address;
const USDC = "0x2222222222222222222222222222222222222222" as Address;
const STOCK = "0x3333333333333333333333333333333333333333" as Address;
const USER = "0x4444444444444444444444444444444444444444" as Address;

function tradeLog(overrides: {
  blockNumber: bigint;
  logIndex: number;
  blockHash?: Hex;
}): IndexerLog {
  const topics = encodeEventTopics({
    abi: [TRADE_EVENT],
    eventName: "Trade",
    args: { trader: USER, stockToken: STOCK, isBuy: true },
  });
  const data = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [100_000_000n, 1_000_000_000_000_000_000n, 100_000_000_000n, 1n, 1_700_000_000n],
  );
  return {
    address: EXCHANGE,
    topics: topics as readonly Hex[],
    data,
    blockNumber: overrides.blockNumber,
    blockHash: overrides.blockHash ?? (`0x${"aa".repeat(32)}` as Hex),
    transactionHash: `0x${"bb".repeat(32)}` as Hex,
    logIndex: overrides.logIndex,
  };
}

function claimLog(blockNumber: bigint, logIndex: number): IndexerLog {
  const topics = encodeEventTopics({
    abi: [WELCOME_CLAIMED_EVENT],
    eventName: "WelcomeClaimed",
    args: { account: USER },
  });
  return {
    address: USDC,
    topics: topics as readonly Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [1_000_000_000n]),
    blockNumber,
    blockHash: `0x${"aa".repeat(32)}`,
    transactionHash: `0x${"cc".repeat(32)}`,
    logIndex,
  };
}

class MemoryStore implements IndexerStore {
  checkpoint: Checkpoint | null = null;
  trades: DecodedTrade[] = [];
  claims: DecodedClaim[] = [];
  rewinds: bigint[] = [];
  async getCheckpoint() {
    return this.checkpoint;
  }
  async saveCheckpoint(input: { blockNumber: bigint; blockHash: Hex }) {
    this.checkpoint = { blockNumber: input.blockNumber, blockHash: input.blockHash };
  }
  async upsertTrade(trade: DecodedTrade) {
    if (
      !this.trades.some((item) => item.txHash === trade.txHash && item.logIndex === trade.logIndex)
    ) {
      this.trades.push(trade);
    }
  }
  async upsertClaim(claim: DecodedClaim) {
    this.claims.push(claim);
  }
  async rewind(_chainId: number, blockNumber: bigint) {
    this.rewinds.push(blockNumber);
    this.trades = this.trades.filter((trade) => trade.blockNumber < blockNumber);
    this.claims = this.claims.filter((claim) => claim.blockNumber < blockNumber);
    this.checkpoint = null;
  }
}

class FakeClient implements IndexerClient {
  constructor(
    public latest: bigint,
    public logs: IndexerLog[],
    public blocks: Map<bigint, IndexerBlock>,
  ) {}
  async getBlockNumber() {
    return this.latest;
  }
  async getBlock({ blockNumber }: { blockNumber: bigint }) {
    return this.blocks.get(blockNumber) ?? null;
  }
  async getLogs({
    addresses,
    fromBlock,
    toBlock,
  }: {
    addresses: readonly Address[];
    fromBlock: bigint;
    toBlock: bigint;
  }) {
    return this.logs.filter(
      (log) =>
        addresses.map((address) => address.toLowerCase()).includes(log.address.toLowerCase()) &&
        log.blockNumber >= fromBlock &&
        log.blockNumber <= toBlock,
    );
  }
}

function blocksFor(
  latest: bigint,
  hashFor: (height: bigint) => Hex = () => `0x${"aa".repeat(32)}`,
) {
  const blocks = new Map<bigint, IndexerBlock>();
  for (let height = 0n; height <= latest; height += 1n) {
    blocks.set(height, {
      number: height,
      hash: hashFor(height),
      timestamp: 1_700_000_000n + height,
    });
  }
  return blocks;
}

const options = {
  chainId: 84_532,
  exchangeAddress: EXCHANGE,
  settlementAddress: USDC,
  symbolByToken: { [STOCK.toLowerCase()]: "tAAPL" },
  confirmations: 12,
  chunkSize: 10n,
  startBlock: 70n,
  reorgDepth: 5n,
};

describe("indexer", () => {
  it("indexes trades and both claim events, then checkpoints", async () => {
    const store = new MemoryStore();
    const client = new FakeClient(
      100n,
      [tradeLog({ blockNumber: 75n, logIndex: 0 }), claimLog(76n, 1)],
      blocksFor(100n),
    );
    const summary = await runIndexerOnce(client, store, options);
    expect(summary).toMatchObject({ trades: 1, claims: 1, reorgRewind: null });
    expect(store.trades[0]?.assetSymbol).toBe("tAAPL");
    expect(store.claims[0]?.kind).toBe("welcome");
    expect(store.checkpoint?.blockNumber).toBe(88n);
  });

  it("resumes after the checkpoint without duplicating logs", async () => {
    const store = new MemoryStore();
    const blocks = blocksFor(100n);
    const client = new FakeClient(100n, [tradeLog({ blockNumber: 75n, logIndex: 0 })], blocks);
    await runIndexerOnce(client, store, options);
    await runIndexerOnce(client, store, options);
    expect(store.trades).toHaveLength(1);
    expect(store.checkpoint?.blockNumber).toBe(88n);
  });

  it("rewinds and reindexes after a checkpoint hash mismatch", async () => {
    const store = new MemoryStore();
    const blocks = blocksFor(100n);
    const client = new FakeClient(100n, [tradeLog({ blockNumber: 75n, logIndex: 0 })], blocks);
    await runIndexerOnce(client, store, options);
    const original = store.trades.length;

    // Simulate a reorg: the checkpointed block now has a different hash.
    const reorged = blocksFor(100n, (height) =>
      height === store.checkpoint?.blockNumber ? `0x${"dd".repeat(32)}` : `0x${"aa".repeat(32)}`,
    );
    client.blocks = reorged;
    const summary = await runIndexerOnce(client, store, options);
    expect(summary.reorgRewind).not.toBeNull();
    expect(store.rewinds).toHaveLength(1);
    expect(store.trades.length).toBe(original);
  });

  it("returns an empty summary when no confirmed blocks remain", async () => {
    const store = new MemoryStore();
    store.checkpoint = { blockNumber: 95n, blockHash: `0x${"aa".repeat(32)}` };
    const client = new FakeClient(100n, [], blocksFor(100n));
    const summary = await runIndexerOnce(client, store, options);
    expect(summary).toMatchObject({ fromBlock: null, trades: 0, claims: 0 });
  });

  it("decodes daily claims", async () => {
    const topics = encodeEventTopics({
      abi: [DAILY_CLAIMED_EVENT],
      eventName: "DailyClaimed",
      args: { account: USER },
    });
    const store = new MemoryStore();
    const log: IndexerLog = {
      address: USDC,
      topics: topics as readonly Hex[],
      data: encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }],
        [100_000_000n, 1_700_086_400n],
      ),
      blockNumber: 80n,
      blockHash: `0x${"aa".repeat(32)}`,
      transactionHash: `0x${"ee".repeat(32)}`,
      logIndex: 2,
    };
    await runIndexerOnce(new FakeClient(100n, [log], blocksFor(100n)), store, options);
    expect(store.claims[0]?.kind).toBe("daily");
  });
});
