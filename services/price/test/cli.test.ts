import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { decodeFunctionData } from "viem";
import { describe, expect, it, vi } from "vitest";

import { SET_PRICE_ABI, parseDeploymentManifest } from "@kyrox/protocol";

import { ConfigError, parseIngestConfig } from "../src/cli/config.js";
import { exitCodeFor, runIngestOnce } from "../src/cli/run.js";
import type { FeedReader } from "../src/feeds/chainlink.js";
import { feedForAsset } from "../src/feeds/registry.js";
import type { FeedConfig, RawFeedObservation } from "../src/feeds/types.js";
import type { SequencerStatus, SequencerUptimeReader } from "../src/feeds/sequencer.js";
import { InMemoryObservationStore } from "../src/persistence/types.js";

const NOW = 1_795_272_505;
const EXCHANGE = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

const config = {
  rpcUrl: "https://mainnet.example/rpc",
  databaseUrl: "postgres://local/kyrox",
  assetSymbols: ["tAAPL"] as const,
  maxSourceAgeSeconds: 600,
  manifestPath: "deployments/local-anvil.json",
};

const healthy: SequencerStatus = {
  feedAddress: "0xBCF85224fc0756B9Fa45aA7892530B47e10b6433",
  sourceChainId: 8453,
  answer: 0,
  roundId: 18_446_744_073_709_551_636n,
  sourceUpdatedAt: NOW - 3_600,
  observedAt: NOW,
  gracePeriodSeconds: 3_600,
  healthy: true,
  gracePeriodElapsed: true,
};

function observation(assetSymbol = "tAAPL", roundId = 100n): RawFeedObservation {
  const feed = feedForAsset(assetSymbol);
  return {
    assetSymbol,
    referenceSymbol: feed.referenceSymbol,
    feedAddress: ZERO,
    sourceChainId: 8453,
    sourceDescription: "Simulated local reference",
    feedDecimals: 8,
    rawAnswer: 23_000_000_000n,
    sourceRoundId: roundId,
    sourceUpdatedAt: NOW - 5,
    observedAt: NOW,
    referencePriceUsdcPerWholeToken: 230_000_000n,
  };
}

function readerFor(map: Record<string, RawFeedObservation | Error>): FeedReader {
  return {
    read: async (feed: FeedConfig) => {
      const value = map[feed.assetSymbol];
      if (value === undefined) throw new Error(`no fixture for ${feed.assetSymbol}`);
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

function sequencer(status: SequencerStatus | Error): SequencerUptimeReader {
  return {
    read: async () => {
      if (status instanceof Error) throw status;
      return status;
    },
  };
}

const localManifest = parseDeploymentManifest({
  chainId: 84_532,
  chain: "base-sepolia",
  environment: "local-anvil",
  status: "local",
  rpc: { url: "http://127.0.0.1:8545" },
  contracts: { KyroxExchange: { address: EXCHANGE } },
  assets: { tAAPL: { address: TOKEN } },
});

describe("price:ingest configuration", () => {
  it("requires RPC, database, and at least one approved ticker", () => {
    expect(() => parseIngestConfig({})).toThrow(ConfigError);
    expect(() =>
      parseIngestConfig({ BASE_MAINNET_RPC_URL: "https://x", DATABASE_URL: "postgres://x" }),
    ).toThrow(ConfigError);
    expect(() =>
      parseIngestConfig({
        BASE_MAINNET_RPC_URL: "https://x",
        DATABASE_URL: "postgres://x",
        PRICE_ALLOWED_TICKERS: "tMSFT",
      }),
    ).toThrow(ConfigError);
  });

  it("rejects a non-http RPC URL and a bad freshness bound", () => {
    expect(() =>
      parseIngestConfig({
        BASE_MAINNET_RPC_URL: "ftp://x",
        DATABASE_URL: "postgres://x",
        PRICE_ALLOWED_TICKERS: "tAAPL",
      }),
    ).toThrow(ConfigError);
    expect(() =>
      parseIngestConfig({
        BASE_MAINNET_RPC_URL: "https://x",
        DATABASE_URL: "postgres://x",
        PRICE_ALLOWED_TICKERS: "tAAPL",
        PRICE_MAX_SOURCE_AGE_SECONDS: "0",
      }),
    ).toThrow(ConfigError);
  });

  it("parses a valid configuration with defaults", () => {
    const parsed = parseIngestConfig({
      BASE_MAINNET_RPC_URL: "https://x",
      DATABASE_URL: "postgres://x",
      PRICE_ALLOWED_TICKERS: "tAAPL, tNVDA",
    });
    expect(parsed.assetSymbols).toEqual(["tAAPL", "tNVDA"]);
    expect(parsed.maxSourceAgeSeconds).toBe(3_600);
    expect(parsed.manifestPath).toBe("deployments/base-sepolia.json");
  });
});

describe("price:ingest one-shot run", () => {
  it("ingests, prepares a local publication, and records it", async () => {
    const store = new InMemoryObservationStore();
    const report = await runIngestOnce(config, {
      reader: readerFor({ tAAPL: observation() }),
      sequencer: sequencer(healthy),
      store,
      loadManifest: () => localManifest,
      nowSeconds: () => NOW,
    });

    expect(report.status).toBe("ok");
    expect(report.ingestion).toEqual({
      published: 1,
      duplicates: 0,
      invalid: 0,
      errors: 0,
      blocked: 0,
    });
    expect(report.publications[0]?.status).toBe("prepared");
    expect(store.observations).toHaveLength(1);
    expect(await store.isPublished("tAAPL", 100n)).toBe(true);

    const publication = report.publications[0];
    const decoded = decodeFunctionData({
      abi: SET_PRICE_ABI,
      data: publication?.calldata as `0x${string}`,
    });
    expect(decoded.functionName).toBe("setPrice");
    const args = decoded.args ?? [];
    expect(String(args[0]).toLowerCase()).toBe(TOKEN);
    expect(args[1]).toBe(230_000_000n);
    expect(args[2]).toBe(100n);
    expect(args[3]).toBe(BigInt(NOW - 5));
    expect(args[4]).toBe(8_453n);
    expect(args[5]).toBe(ZERO);
    expect(args[6]).toBe(true);
    expect(exitCodeFor(report)).toBe(0);
  });

  it("reports blocked publication when no manifest exists but ingestion succeeds", async () => {
    const report = await runIngestOnce(config, {
      reader: readerFor({ tAAPL: observation() }),
      sequencer: sequencer(healthy),
      store: new InMemoryObservationStore(),
      loadManifest: () => null,
      nowSeconds: () => NOW,
    });

    expect(report.status).toBe("ok");
    expect(report.ingestion.published).toBe(1);
    expect(report.publications[0]?.status).toBe("blocked");
    expect(report.publications[0]?.reason).toContain("manifest not found");
    expect(exitCodeFor(report)).toBe(0);
  });

  it("stops before reading feeds when the sequencer is down", async () => {
    const read = vi.fn();
    const store = new InMemoryObservationStore();
    const report = await runIngestOnce(config, {
      reader: { read },
      sequencer: sequencer({ ...healthy, answer: 1, healthy: false }),
      store,
      loadManifest: () => localManifest,
      nowSeconds: () => NOW,
    });

    expect(read).not.toHaveBeenCalled();
    expect(report.status).toBe("blocked");
    expect(report.ingestion.blocked).toBe(1);
    expect(store.events[0]?.outcome).toBe("sequencer_blocked");
    expect(exitCodeFor(report)).toBe(3);
  });

  it("fails closed when the sequencer check errors", async () => {
    const store = new InMemoryObservationStore();
    const report = await runIngestOnce(config, {
      reader: readerFor({ tAAPL: observation() }),
      sequencer: sequencer(new Error("sequencer rpc down")),
      store,
      loadManifest: () => localManifest,
      nowSeconds: () => NOW,
    });

    expect(report.status).toBe("blocked");
    expect(store.events[0]?.outcome).toBe("sequencer_error");
    expect(exitCodeFor(report)).toBe(3);
  });

  it("isolates a per-asset failure and exits non-zero", async () => {
    const store = new InMemoryObservationStore();
    const report = await runIngestOnce(
      { ...config, assetSymbols: ["tAAPL", "tTSLA"] },
      {
        reader: readerFor({
          tAAPL: observation("tAAPL"),
          tTSLA: new Error("rpc timeout"),
        }),
        sequencer: sequencer(healthy),
        store,
        loadManifest: () => localManifest,
        nowSeconds: () => NOW,
      },
    );

    expect(report.ingestion.published).toBe(1);
    expect(report.ingestion.errors).toBe(1);
    expect(report.status).toBe("partial");
    expect(exitCodeFor(report)).toBe(1);
    expect(store.events.some((event) => event.outcome === "rpc_error")).toBe(true);
  });

  it("is idempotent across repeated runs and reports no new round", async () => {
    const store = new InMemoryObservationStore();
    const deps = {
      reader: readerFor({ tAAPL: observation() }),
      sequencer: sequencer(healthy),
      store,
      loadManifest: () => localManifest,
      nowSeconds: () => NOW,
    };
    const first = await runIngestOnce(config, deps);
    const second = await runIngestOnce(config, deps);

    expect(first.ingestion.published).toBe(1);
    expect(second.ingestion.published).toBe(0);
    expect(second.ingestion.duplicates).toBe(1);
    expect(second.status).toBe("ok");
    expect(second.publications[0]?.status).toBe("duplicate");
    expect(exitCodeFor(second)).toBe(0);
  });

  it("rejects an older round when a newer publication already exists", async () => {
    const store = new InMemoryObservationStore();
    await store.recordPublication({
      assetSymbol: "tAAPL",
      sourceRoundId: 200n,
      exchangeAddress: EXCHANGE,
      calldataHash: "0x00",
      preparedAt: NOW - 100,
      stockToken: TOKEN,
      referencePriceUsdcPerWholeToken: 230_000_000n,
      sourceUpdatedAt: NOW - 200,
      sourceChainId: 8_453,
      feedAddress: ZERO,
      simulated: true,
      observedAt: NOW - 100,
      artifactHash: "",
      artifactJson: "",
    });

    const report = await runIngestOnce(config, {
      reader: readerFor({ tAAPL: observation() }),
      sequencer: sequencer(healthy),
      store,
      loadManifest: () => localManifest,
      nowSeconds: () => NOW,
    });

    expect(report.publications[0]?.status).toBe("duplicate");
    expect(report.publications[0]?.reason).toContain("not newer");
  });

  it("blocks a local manifest that points outside loopback", async () => {
    const badManifest = parseDeploymentManifest({
      chainId: 84_532,
      chain: "base-sepolia",
      environment: "local-anvil",
      status: "local",
      rpc: { url: "https://base-mainnet.example" },
      contracts: { KyroxExchange: { address: EXCHANGE } },
      assets: { tAAPL: { address: TOKEN } },
    });
    const report = await runIngestOnce(config, {
      reader: readerFor({ tAAPL: observation() }),
      sequencer: sequencer(healthy),
      store: new InMemoryObservationStore(),
      loadManifest: () => badManifest,
      nowSeconds: () => NOW,
    });
    expect(report.publications[0]?.status).toBe("blocked");
    expect(report.publications[0]?.reason).toContain("loopback");
  });

  it("blocks an unpopulated Base Sepolia manifest", async () => {
    const emptyManifest = parseDeploymentManifest({
      chainId: 84_532,
      chain: "base-sepolia",
      status: "unpopulated",
      contracts: {},
    });
    const report = await runIngestOnce(config, {
      reader: readerFor({ tAAPL: observation() }),
      sequencer: sequencer(healthy),
      store: new InMemoryObservationStore(),
      loadManifest: () => emptyManifest,
      nowSeconds: () => NOW,
    });
    expect(report.publications[0]?.status).toBe("blocked");
    expect(report.publications[0]?.reason).toContain("unpopulated");
  });

  it("rejects and does not persist an observation outside the contract bounds", async () => {
    const boundedManifest = parseDeploymentManifest({
      chainId: 84_532,
      chain: "base-sepolia",
      environment: "local-anvil",
      status: "local",
      rpc: { url: "http://127.0.0.1:8545" },
      contracts: { KyroxExchange: { address: EXCHANGE } },
      assets: {
        tAAPL: {
          address: TOKEN,
          maxSourceAgeSeconds: 600,
          maxPriceDeviationBps: 500,
          minPriceUsdcPerWholeToken: "300000000",
          maxPriceUsdcPerWholeToken: "1000000000",
        },
      },
    });
    const store = new InMemoryObservationStore();
    const report = await runIngestOnce(config, {
      reader: readerFor({ tAAPL: observation() }),
      sequencer: sequencer(healthy),
      store,
      loadManifest: () => boundedManifest,
      nowSeconds: () => NOW,
    });
    expect(report.publications[0]?.status).toBe("rejected");
    expect(await store.isPublished("tAAPL", 100n)).toBe(false);
  });

  it("reports a stale observation as rejected, not prepared", async () => {
    const store = new InMemoryObservationStore();
    await store.insertObservation({
      ...observation(),
      sourceUpdatedAt: NOW - 7_200,
      observedAt: NOW,
      status: "valid",
    });

    const report = await runIngestOnce(config, {
      reader: { read: async () => observation() },
      sequencer: sequencer(healthy),
      store,
      loadManifest: () => localManifest,
      nowSeconds: () => NOW,
    });

    expect(report.publications[0]?.status).toBe("rejected");
    expect(report.status).toBe("partial");
    expect(await store.isPublished("tAAPL", 100n)).toBe(false);
    expect(exitCodeFor(report)).toBe(1);
  });

  it("has no signing or broadcast path in its sources", () => {
    for (const file of ["config.ts", "run.ts", "main.ts"]) {
      const source = readFileSync(
        fileURLToPath(new URL(`../src/cli/${file}`, import.meta.url)),
        "utf8",
      );
      for (const forbidden of [
        "signTransaction",
        "sendTransaction",
        "sendRawTransaction",
        "writeContract",
        "privateKey",
        "walletClient",
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });
});
