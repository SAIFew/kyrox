import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";

import { SET_PRICE_ABI } from "@kyrox/protocol";
import { parseDeploymentManifest } from "@kyrox/protocol";

import { feedForAsset } from "../src/feeds/registry.js";
import { InMemoryObservationStore, type ObservationInsert } from "../src/persistence/types.js";
import { PublicationError, prepareSetPricePublication } from "../src/publication/prepare.js";

const NOW = 1_795_000_000;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;
const EXCHANGE = "0x1111111111111111111111111111111111111111" as const;
const feed = feedForAsset("tAAPL");

const manifest = parseDeploymentManifest({
  chainId: 84_532,
  chain: "base-sepolia",
  status: "test",
  contracts: { KyroxExchange: { address: EXCHANGE, verified: true } },
});

const observation: ObservationInsert = {
  assetSymbol: "tAAPL",
  sourceChainId: 8453,
  feedAddress: feed.feedAddress,
  rawAnswer: 34_529_769_685n,
  feedDecimals: 8,
  sourceRoundId: 36_893_488_147_419_103_834n,
  sourceUpdatedAt: NOW - 60,
  observedAt: NOW,
  referencePriceUsdcPerWholeToken: 345_297_696n,
  sourceDescription: "Coinbase AAPL",
  status: "valid",
};

describe("prepareSetPricePublication", () => {
  it("encodes setPrice with preserved provenance", async () => {
    const prepared = await prepareSetPricePublication({
      observation,
      stockToken: TOKEN,
      manifest,
      nowSeconds: NOW,
    });

    const decoded = decodeFunctionData({ abi: SET_PRICE_ABI, data: prepared.data });
    expect(decoded.functionName).toBe("setPrice");
    expect(decoded.args).toEqual([
      TOKEN,
      observation.referencePriceUsdcPerWholeToken,
      observation.sourceRoundId,
      BigInt(observation.sourceUpdatedAt),
      8453n,
      observation.feedAddress,
      false,
    ]);

    expect(prepared.to).toBe(EXCHANGE);
    expect(prepared.value).toBe(0n);
    expect(prepared.simulated).toBe(false);
    expect(prepared.sourceUpdatedAt).toBe(NOW - 60);
    expect(prepared.sourceRoundId).toBe(observation.sourceRoundId);
  });

  it("produces deterministic calldata and hash", async () => {
    const a = await prepareSetPricePublication({
      observation,
      stockToken: TOKEN,
      manifest,
      nowSeconds: NOW,
    });
    const b = await prepareSetPricePublication({
      observation,
      stockToken: TOKEN,
      manifest,
      nowSeconds: NOW,
    });
    expect(a.data).toBe(b.data);
    expect(a.calldataHash).toBe(b.calldataHash);
    expect(a.calldataHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("rejects a duplicate round already recorded", async () => {
    const store = new InMemoryObservationStore();
    await prepareSetPricePublication({
      observation,
      stockToken: TOKEN,
      manifest,
      store,
      nowSeconds: NOW,
    });

    await expect(
      prepareSetPricePublication({
        observation,
        stockToken: TOKEN,
        manifest,
        store,
        nowSeconds: NOW,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_ROUND" });
  });

  it("rejects a round not newer than the last published round", async () => {
    await expect(
      prepareSetPricePublication({
        observation,
        stockToken: TOKEN,
        manifest,
        nowSeconds: NOW,
        lastPublishedRoundId: observation.sourceRoundId,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_ROUND" });
  });

  it("rejects a non-Sepolia source chain", async () => {
    await expect(
      prepareSetPricePublication({
        observation: { ...observation, sourceChainId: 84_532 },
        stockToken: TOKEN,
        manifest,
        nowSeconds: NOW,
      }),
    ).rejects.toMatchObject({ code: "WRONG_SOURCE_CHAIN" });
  });

  it("refuses to prepare when no deployment exists", async () => {
    await expect(
      prepareSetPricePublication({
        observation,
        stockToken: TOKEN,
        manifest: null,
        nowSeconds: NOW,
      }),
    ).rejects.toMatchObject({ code: "DEPLOYMENT_UNAVAILABLE" });

    const empty = parseDeploymentManifest({
      chainId: 84_532,
      chain: "base-sepolia",
      status: "unpopulated",
      contracts: {},
    });
    await expect(
      prepareSetPricePublication({
        observation,
        stockToken: TOKEN,
        manifest: empty,
        nowSeconds: NOW,
      }),
    ).rejects.toMatchObject({ code: "DEPLOYMENT_UNAVAILABLE" });
  });

  it("rejects invalid, unpriced, future, and malformed observations", async () => {
    await expect(
      prepareSetPricePublication({
        observation: { ...observation, status: "invalid" },
        stockToken: TOKEN,
        manifest,
        nowSeconds: NOW,
      }),
    ).rejects.toMatchObject({ code: "NOT_A_VALID_OBSERVATION" });

    await expect(
      prepareSetPricePublication({
        observation: { ...observation, referencePriceUsdcPerWholeToken: null },
        stockToken: TOKEN,
        manifest,
        nowSeconds: NOW,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PRICE" });

    await expect(
      prepareSetPricePublication({
        observation: { ...observation, sourceUpdatedAt: NOW + 1 },
        stockToken: TOKEN,
        manifest,
        nowSeconds: NOW,
      }),
    ).rejects.toMatchObject({ code: "FUTURE_TIMESTAMP" });

    await expect(
      prepareSetPricePublication({
        observation,
        stockToken: "0x0000000000000000000000000000000000000000",
        manifest,
        nowSeconds: NOW,
      }),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("rejects a price outside the asset band", async () => {
    await expect(
      prepareSetPricePublication({
        observation,
        stockToken: TOKEN,
        manifest,
        nowSeconds: NOW,
        priceBounds: {
          minPriceUsdcPerWholeToken: 400_000_000n,
          maxPriceUsdcPerWholeToken: 500_000_000n,
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_PRICE" });
  });

  it("rejects an observation already outside the freshness window", async () => {
    await expect(
      prepareSetPricePublication({
        observation,
        stockToken: TOKEN,
        manifest,
        nowSeconds: NOW,
        maxSourceAgeSeconds: 30,
      }),
    ).rejects.toMatchObject({ code: "STALE_OBSERVATION" });
  });

  it("publishes a simulated observation only with a zero feed address", async () => {
    const zeroFeedObservation = {
      ...observation,
      feedAddress: "0x0000000000000000000000000000000000000000" as const,
    };
    const prepared = await prepareSetPricePublication({
      observation: zeroFeedObservation,
      stockToken: TOKEN,
      manifest,
      nowSeconds: NOW,
      simulated: true,
    });
    const decoded = decodeFunctionData({ abi: SET_PRICE_ABI, data: prepared.data });
    expect(decoded.args?.[5]).toBe("0x0000000000000000000000000000000000000000");
    expect(decoded.args?.[6]).toBe(true);
    expect(prepared.simulated).toBe(true);

    await expect(
      prepareSetPricePublication({
        observation,
        stockToken: TOKEN,
        manifest,
        nowSeconds: NOW,
        simulated: true,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PROVENANCE" });
  });

  it("refuses a production publication without a feed address", async () => {
    await expect(
      prepareSetPricePublication({
        observation: {
          ...observation,
          feedAddress: "0x0000000000000000000000000000000000000000",
        },
        stockToken: TOKEN,
        manifest,
        nowSeconds: NOW,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PROVENANCE" });
  });

  it("has no signing or submission path in its source", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/publication/prepare.ts", import.meta.url)),
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
  });

  it("uses a typed error for every rejection", async () => {
    await expect(
      prepareSetPricePublication({
        observation,
        stockToken: TOKEN,
        manifest: null,
        nowSeconds: NOW,
      }),
    ).rejects.toBeInstanceOf(PublicationError);
  });
});
