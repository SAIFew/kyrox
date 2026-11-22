import { describe, expect, it, vi } from "vitest";

import { ChainlinkFeedReader } from "../src/feeds/chainlink.js";
import { feedForAsset, VERIFIED_FEEDS } from "../src/feeds/registry.js";
import type { EvmReadClient, FeedConfig, LatestRoundData } from "../src/feeds/types.js";
import { FeedValidationError, SOURCE_CHAIN_ID } from "../src/feeds/types.js";

const NOW = 1_795_000_000;

const feed = feedForAsset("tAAPL");

const validRound: LatestRoundData = {
  roundId: 36_893_488_147_419_103_834n,
  answer: 34_529_769_685n,
  startedAt: BigInt(NOW - 100),
  updatedAt: BigInt(NOW - 60),
  answeredInRound: 36_893_488_147_419_103_834n,
};

function client(overrides: Partial<EvmReadClient> = {}): EvmReadClient {
  return {
    getChainId: vi.fn(async () => SOURCE_CHAIN_ID),
    getBytecode: vi.fn(async () => "0x6080604052"),
    readDecimals: vi.fn(async () => 8),
    readDescription: vi.fn(async () => "Coinbase AAPL"),
    readLatestRoundData: vi.fn(async () => validRound),
    ...overrides,
  };
}

describe("ChainlinkFeedReader", () => {
  it("reads a valid observation and preserves source provenance", async () => {
    const reader = new ChainlinkFeedReader(client(), () => NOW);
    const observation = await reader.read(feed);

    expect(observation.assetSymbol).toBe("tAAPL");
    expect(observation.referenceSymbol).toBe("AAPL");
    expect(observation.feedAddress).toBe(feed.feedAddress);
    expect(observation.sourceChainId).toBe(8453);
    expect(observation.sourceDescription).toBe("Coinbase AAPL");
    expect(observation.feedDecimals).toBe(8);
    expect(observation.rawAnswer).toBe(34_529_769_685n);
    expect(observation.sourceRoundId).toBe(validRound.roundId);
    expect(observation.sourceUpdatedAt).toBe(NOW - 60);
    expect(observation.observedAt).toBe(NOW);
    expect(observation.referencePriceUsdcPerWholeToken).toBe(345_297_696n);
  });

  it("preserves an old source timestamp instead of refreshing it", async () => {
    const weekend = {
      ...validRound,
      updatedAt: BigInt(NOW - 3 * 24 * 60 * 60),
      startedAt: BigInt(NOW - 3 * 24 * 60 * 60),
    };
    const reader = new ChainlinkFeedReader(
      client({ readLatestRoundData: async () => weekend }),
      () => NOW,
    );
    const observation = await reader.read(feed);
    expect(observation.sourceUpdatedAt).toBe(NOW - 3 * 24 * 60 * 60);
    expect(observation.observedAt).toBe(NOW);
    expect(observation.sourceUpdatedAt).not.toBe(observation.observedAt);
  });

  it("rejects a wrong RPC chain", async () => {
    const reader = new ChainlinkFeedReader(client({ getChainId: async () => 84_532 }), () => NOW);
    await expect(reader.read(feed)).rejects.toMatchObject({ code: "WRONG_SOURCE_CHAIN" });
  });

  it("rejects a feed configured for another chain", async () => {
    const reader = new ChainlinkFeedReader(client(), () => NOW);
    const wrong = { ...feed, expectedChainId: 84_532 } as unknown as FeedConfig;
    await expect(reader.read(wrong)).rejects.toMatchObject({ code: "WRONG_SOURCE_CHAIN" });
  });

  it("rejects a proxy with no contract code", async () => {
    const reader = new ChainlinkFeedReader(client({ getBytecode: async () => "0x" }), () => NOW);
    await expect(reader.read(feed)).rejects.toMatchObject({ code: "MISSING_CONTRACT" });

    const missing = new ChainlinkFeedReader(
      client({ getBytecode: async () => undefined }),
      () => NOW,
    );
    await expect(missing.read(feed)).rejects.toMatchObject({ code: "MISSING_CONTRACT" });
  });

  it("rejects unexpected feed decimals", async () => {
    const reader = new ChainlinkFeedReader(client({ readDecimals: async () => 18 }), () => NOW);
    await expect(reader.read(feed)).rejects.toMatchObject({ code: "INVALID_DECIMALS" });
  });

  it("rejects a mismatched description", async () => {
    const reader = new ChainlinkFeedReader(
      client({ readDescription: async () => "Coinbase TSLA" }),
      () => NOW,
    );
    await expect(reader.read(feed)).rejects.toMatchObject({ code: "DESCRIPTION_MISMATCH" });
  });

  it("rejects non-positive answers", async () => {
    for (const answer of [0n, -1n, -34_529_769_685n]) {
      const reader = new ChainlinkFeedReader(
        client({ readLatestRoundData: async () => ({ ...validRound, answer }) }),
        () => NOW,
      );
      await expect(reader.read(feed)).rejects.toMatchObject({ code: "NON_POSITIVE_ANSWER" });
    }
  });

  it("rejects zero, future, and unsafe timestamps", async () => {
    const zero = new ChainlinkFeedReader(
      client({ readLatestRoundData: async () => ({ ...validRound, updatedAt: 0n }) }),
      () => NOW,
    );
    await expect(zero.read(feed)).rejects.toMatchObject({ code: "INVALID_TIMESTAMP" });

    const future = new ChainlinkFeedReader(
      client({ readLatestRoundData: async () => ({ ...validRound, updatedAt: BigInt(NOW + 1) }) }),
      () => NOW,
    );
    await expect(future.read(feed)).rejects.toMatchObject({ code: "FUTURE_TIMESTAMP" });
  });

  it("rejects zero and incomplete rounds", async () => {
    const zeroRound = new ChainlinkFeedReader(
      client({
        readLatestRoundData: async () => ({ ...validRound, roundId: 0n, answeredInRound: 0n }),
      }),
      () => NOW,
    );
    await expect(zeroRound.read(feed)).rejects.toMatchObject({ code: "INVALID_ROUND" });

    const incomplete = new ChainlinkFeedReader(
      client({
        readLatestRoundData: async () => ({
          ...validRound,
          answeredInRound: validRound.roundId - 1n,
        }),
      }),
      () => NOW,
    );
    await expect(incomplete.read(feed)).rejects.toMatchObject({ code: "INCOMPLETE_ROUND" });
  });

  it("rejects a zero normalized price", async () => {
    const reader = new ChainlinkFeedReader(
      client({ readLatestRoundData: async () => ({ ...validRound, answer: 1n }) }),
      () => NOW,
    );
    await expect(reader.read(feed)).rejects.toMatchObject({ code: "IMPLAUSIBLE_ANSWER" });
  });

  it("propagates RPC failures as non-validation errors", async () => {
    const rpcError = new Error("rpc unavailable");
    const reader = new ChainlinkFeedReader(
      client({
        readLatestRoundData: async () => {
          throw rpcError;
        },
      }),
      () => NOW,
    );
    await expect(reader.read(feed)).rejects.toBe(rpcError);
    try {
      await reader.read(feed);
    } catch (error) {
      expect(error).not.toBeInstanceOf(FeedValidationError);
    }
  });

  it("refuses a disabled feed", async () => {
    const reader = new ChainlinkFeedReader(client(), () => NOW);
    await expect(reader.read({ ...feed, enabled: false })).rejects.toMatchObject({
      code: "FEED_DISABLED",
    });
  });

  it("can read every verified asset binding", async () => {
    for (const entry of VERIFIED_FEEDS) {
      const reader = new ChainlinkFeedReader(
        client({ readDescription: async () => entry.expectedDescription }),
        () => NOW,
      );
      const observation = await reader.read(entry);
      expect(observation.assetSymbol).toBe(entry.assetSymbol);
      expect(observation.sourceRoundId).toBe(validRound.roundId);
    }
  });
});
