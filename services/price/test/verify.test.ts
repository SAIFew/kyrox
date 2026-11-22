import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, keccak256, type Hex } from "viem";

import {
  PRICE_SET_EVENT_ABI,
  createPublicationArtifact,
  encodeSetPrice,
  parseDeploymentManifest,
} from "@kyrox/protocol";

import { parseVerifyArgs, verifyExitCode } from "../src/cli/verify-main.js";
import { InMemoryObservationStore, type PublicationRecord } from "../src/persistence/types.js";
import { VerificationError, verifyPublication } from "../src/verification/verify.js";
import type {
  OnChainObservation,
  TransactionReceipt,
  VerificationRpc,
} from "../src/verification/types.js";

const NOW = 1_795_272_505;
const EXCHANGE = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;
const OTHER = "0x9999999999999999999999999999999999999999" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const TX_HASH = `0x${"aa".repeat(32)}` as Hex;
const BLOCK_HASH = `0x${"bb".repeat(32)}` as Hex;

const manifest = parseDeploymentManifest({
  chainId: 84_532,
  chain: "base-sepolia",
  environment: "local-anvil",
  status: "local-anvil",
  rpc: { url: "http://127.0.0.1:8545" },
  contracts: { KyroxExchange: { address: EXCHANGE } },
  assets: { tAAPL: { address: TOKEN } },
});

const calldata = encodeSetPrice(EXCHANGE, {
  stockToken: TOKEN,
  priceUsdcPerWholeToken: 230_000_000n,
  sourceRoundId: 1n,
  sourceUpdatedAt: NOW - 5,
  sourceChainId: 8_453,
  feedAddress: ZERO,
  simulated: true,
});

const calldataHash = keccak256(calldata.data);

const publication: PublicationRecord = {
  assetSymbol: "tAAPL",
  sourceRoundId: 1n,
  exchangeAddress: EXCHANGE,
  calldataHash,
  preparedAt: NOW - 100,
  stockToken: TOKEN,
  referencePriceUsdcPerWholeToken: 230_000_000n,
  sourceUpdatedAt: NOW - 5,
  sourceChainId: 8_453,
  feedAddress: ZERO,
  simulated: true,
  observedAt: NOW - 100,
  artifactHash: "",
  artifactJson: "",
};

const observation: OnChainObservation = {
  priceUsdcPerWholeToken: 230_000_000n,
  sourceRoundId: 1n,
  sourceUpdatedAt: NOW - 5,
  publishedAt: NOW,
  sourceChainId: 8_453,
  feedAddress: ZERO,
  simulated: true,
};

function priceSetLog(publishedAt = NOW) {
  const topics = encodeEventTopics({
    abi: PRICE_SET_EVENT_ABI,
    eventName: "PriceSet",
    args: { stockToken: TOKEN, feedAddress: ZERO },
  }) as unknown as readonly Hex[];
  const data = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "bool" },
      { type: "uint256" },
    ],
    [230_000_000n, 1n, BigInt(NOW - 5), 8_453n, true, BigInt(publishedAt)],
  );
  return { address: EXCHANGE, topics, data };
}

function rpc(overrides: Partial<VerificationRpc> = {}): VerificationRpc {
  return {
    getChainId: async () => 84_532,
    getTransactionReceipt: async (): Promise<TransactionReceipt | null> => ({
      status: "success",
      to: EXCHANGE,
      blockNumber: 100n,
      blockHash: BLOCK_HASH,
      logs: [priceSetLog()],
    }),
    getTransaction: async () => ({ to: EXCHANGE, input: calldata.data }),
    getBlockNumber: async () => 105n,
    getBlock: async () => ({ timestamp: NOW, hash: BLOCK_HASH }),
    readObservation: async () => observation,
    ...overrides,
  };
}

async function store(): Promise<InMemoryObservationStore> {
  const value = new InMemoryObservationStore();
  await value.recordPublication(publication);
  return value;
}

const params = {
  assetSymbol: "tAAPL",
  sourceRoundId: 1n,
  txHash: TX_HASH,
  manifest,
  minConfirmations: 3,
  mode: "local" as const,
};

const artifact = createPublicationArtifact({
  exchange: EXCHANGE,
  stockToken: TOKEN,
  assetSymbol: "tAAPL",
  calldata: calldata.data,
  calldataHash,
  priceUsdcPerWholeToken: 230_000_000n,
  sourceRoundId: 1n,
  sourceUpdatedAt: NOW - 5,
  sourceChainId: 8_453,
  feedAddress: ZERO,
  simulated: true,
});

describe("publication verification", () => {
  it("verifies a matching transaction and observation", async () => {
    const db = await store();
    const report = await verifyPublication({ ...params, store: db, rpc: rpc() });

    expect(report.state).toBe("verified");
    expect(report.failures).toEqual([]);
    expect(report.confirmations).toBe(6);
    expect(report.checks).toContain("calldata hash matches the prepared publication");
    expect((await db.getPublication("tAAPL", 1n))?.status).toBe("verified");
  });

  it("verifies the publication artifact and rejects a tampered artifact hash", async () => {
    const db = await store();
    const record = await db.getPublication("tAAPL", 1n);
    if (record === null) throw new Error("missing test publication");
    db.publications[0] = {
      ...record,
      artifactHash: artifact.artifactHash,
      artifactJson: JSON.stringify(artifact),
    };
    const report = await verifyPublication({ ...params, store: db, rpc: rpc() });
    expect(report.state).toBe("verified");
    expect(report.checks).toContain("publication artifact hash matches");

    const tamperedDb = await store();
    const tampered = await tamperedDb.getPublication("tAAPL", 1n);
    if (tampered === null) throw new Error("missing test publication");
    tamperedDb.publications[0] = {
      ...tampered,
      artifactHash: `0x${"ff".repeat(32)}`,
      artifactJson: JSON.stringify(artifact),
    };
    const tamperedReport = await verifyPublication({ ...params, store: tamperedDb, rpc: rpc() });
    expect(tamperedReport.state).toBe("mismatch");
    expect(tamperedReport.failures.join(" ")).toContain("artifact hash");
  });

  it("is idempotent on repeat verification", async () => {
    const db = await store();
    const first = await verifyPublication({ ...params, store: db, rpc: rpc() });
    const second = await verifyPublication({ ...params, store: db, rpc: rpc() });
    expect(first.state).toBe("verified");
    expect(second.state).toBe("verified");
    expect((await db.getPublication("tAAPL", 1n))?.status).toBe("verified");
  });

  it("reports included but not verified below the confirmation threshold", async () => {
    const db = await store();
    const report = await verifyPublication({
      ...params,
      store: db,
      rpc: rpc(),
      minConfirmations: 100,
    });
    expect(report.state).toBe("included");
    expect(report.failures[0]).toContain("below the required");
    expect((await db.getPublication("tAAPL", 1n))?.status).toBe("included");
  });

  it("treats a missing receipt as pending", async () => {
    const db = await store();
    const report = await verifyPublication({
      ...params,
      store: db,
      rpc: rpc({ getTransactionReceipt: async () => null }),
    });
    expect(report.state).toBe("pending");
    expect((await db.getPublication("tAAPL", 1n))?.status).toBe("submitted");
  });

  it("fails a reverted transaction", async () => {
    const db = await store();
    const report = await verifyPublication({
      ...params,
      store: db,
      rpc: rpc({
        getTransactionReceipt: async (): Promise<TransactionReceipt | null> => ({
          status: "reverted",
          to: EXCHANGE,
          blockNumber: 100n,
          blockHash: BLOCK_HASH,
          logs: [],
        }),
      }),
    });
    expect(report.state).toBe("failed");
    expect((await db.getPublication("tAAPL", 1n))?.status).toBe("failed");
  });

  it("rejects the wrong destination exchange", async () => {
    const db = await store();
    const report = await verifyPublication({
      ...params,
      store: db,
      rpc: rpc({
        getTransactionReceipt: async (): Promise<TransactionReceipt | null> => ({
          status: "success",
          to: OTHER,
          blockNumber: 100n,
          blockHash: BLOCK_HASH,
          logs: [],
        }),
      }),
    });
    expect(report.state).toBe("mismatch");
    expect(report.failures.join(" ")).toContain("destination");
  });

  it("rejects modified calldata and provenance", async () => {
    const modified = encodeSetPrice(EXCHANGE, {
      stockToken: TOKEN,
      priceUsdcPerWholeToken: 240_000_000n,
      sourceRoundId: 1n,
      sourceUpdatedAt: NOW - 5,
      sourceChainId: 8_453,
      feedAddress: ZERO,
      simulated: true,
    });
    const db = await store();
    const report = await verifyPublication({
      ...params,
      store: db,
      rpc: rpc({ getTransaction: async () => ({ to: EXCHANGE, input: modified.data }) }),
    });
    expect(report.state).toBe("mismatch");
    expect(report.failures.join(" ")).toContain("calldata hash");

    const db2 = await store();
    const report2 = await verifyPublication({
      ...params,
      store: db2,
      rpc: rpc({
        readObservation: async () => ({ ...observation, sourceUpdatedAt: NOW - 50 }),
      }),
    });
    expect(report2.state).toBe("mismatch");
    expect(report2.failures.join(" ")).toContain("timestamp");
  });

  it("rejects a wrong source round and a wrong token", async () => {
    const db = await store();
    await expect(
      verifyPublication({ ...params, sourceRoundId: 2n, store: db, rpc: rpc() }),
    ).rejects.toBeInstanceOf(VerificationError);

    const db2 = await store();
    const wrongTokenManifest = parseDeploymentManifest({
      chainId: 84_532,
      chain: "base-sepolia",
      environment: "local-anvil",
      status: "local-anvil",
      rpc: { url: "http://127.0.0.1:8545" },
      contracts: { KyroxExchange: { address: EXCHANGE } },
      assets: { tAAPL: { address: OTHER } },
    });
    const report = await verifyPublication({
      ...params,
      manifest: wrongTokenManifest,
      store: db2,
      rpc: rpc(),
    });
    expect(report.state).toBe("mismatch");
    expect(report.failures.join(" ")).toContain("token");
  });

  it("detects a reorg and never downgrades a verified record", async () => {
    const db = await store();
    await db.updatePublication({
      assetSymbol: "tAAPL",
      sourceRoundId: 1n,
      status: "verified",
      transactionHash: TX_HASH,
      blockHash: `0x${"cc".repeat(32)}` as Hex,
      confirmations: 3,
    });

    const report = await verifyPublication({ ...params, store: db, rpc: rpc() });
    expect(report.state).toBe("reorged");
    expect((await db.getPublication("tAAPL", 1n))?.status).toBe("reorged");
    expect((await db.getPublication("tAAPL", 1n))?.reorgDetected).toBe(true);
  });

  it("rejects a local-anvil manifest in production mode", async () => {
    await expect(
      verifyPublication({
        ...params,
        mode: "production",
        chainIdentity: {
          chainId: 84_532,
          genesisHash: `0x${"00".repeat(32)}`,
          checkpointBlock: 1n,
          checkpointHash: `0x${"00".repeat(32)}`,
          providers: ["a", "b"],
        },
        store: await store(),
        rpc: rpc(),
      }),
    ).rejects.toBeInstanceOf(VerificationError);
  });

  it("rejects the wrong chain", async () => {
    await expect(
      verifyPublication({
        ...params,
        store: await store(),
        rpc: rpc({ getChainId: async () => 8_453 }),
      }),
    ).rejects.toBeInstanceOf(VerificationError);
  });

  it("fails closed without a prepared record or a deployed manifest", async () => {
    await expect(
      verifyPublication({
        ...params,
        sourceRoundId: 2n,
        store: new InMemoryObservationStore(),
        rpc: rpc(),
      }),
    ).rejects.toBeInstanceOf(VerificationError);

    const proposal = parseDeploymentManifest({
      chainId: 84_532,
      chain: "base-sepolia",
      environment: "base-sepolia-proposal",
      status: "not_deployed",
      contracts: { KyroxExchange: { address: EXCHANGE } },
      assets: { tAAPL: { address: TOKEN } },
    });
    await expect(
      verifyPublication({ ...params, manifest: proposal, store: await store(), rpc: rpc() }),
    ).rejects.toBeInstanceOf(VerificationError);
  });

  it("parses CLI arguments and exit codes", () => {
    const args = parseVerifyArgs(["--asset", "tAAPL", "--round", "123", "--tx-hash", TX_HASH], {
      BASE_SEPOLIA_RPC_URL: "https://sepolia.example",
      BASE_SEPOLIA_RPC_URL_SECONDARY: "https://sepolia2.example",
      DATABASE_URL: "postgres://local/kyrox",
    });
    expect(args.sourceRoundId).toBe(123n);
    expect(args.minConfirmations).toBe(3);
    expect(() => parseVerifyArgs([], {})).toThrow();
    expect(() =>
      parseVerifyArgs(["--asset", "tAAPL", "--round", "-1", "--tx-hash", TX_HASH], {}),
    ).toThrow();
    expect(verifyExitCode("verified")).toBe(0);
    expect(verifyExitCode("included")).toBe(4);
    expect(verifyExitCode("pending")).toBe(3);
    expect(verifyExitCode("mismatch")).toBe(1);
  });
});
