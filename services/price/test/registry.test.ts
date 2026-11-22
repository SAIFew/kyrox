import { describe, expect, it } from "vitest";

import { FEED_SOURCES, VERIFIED_FEEDS, feedForAsset } from "../src/feeds/registry.js";
import { FeedValidationError, SOURCE_CHAIN_ID } from "../src/feeds/types.js";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

const VERIFIED_ADDRESSES: Record<string, string> = {
  tAAPL: "0x787f13dEa48Db0897CbCDD985de77809D837F988",
  tTSLA: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4",
  tNVDA: "0x04689a41629776563E6822F76f2e57D148d28513",
};

describe("verified feed registry", () => {
  it("maps every synthetic asset to its verified reference feed", () => {
    expect(VERIFIED_FEEDS).toHaveLength(3);
    for (const feed of VERIFIED_FEEDS) {
      expect(feed.expectedChainId).toBe(SOURCE_CHAIN_ID);
      expect(feed.expectedDecimals).toBe(8);
      expect(feed.enabled).toBe(true);
      expect(feed.feedAddress).toBe(VERIFIED_ADDRESSES[feed.assetSymbol]);
      expect(feed.feedAddress).toMatch(ADDRESS_PATTERN);
      expect(feed.expectedDescription).toBe(`Coinbase ${feed.referenceSymbol}`);
      expect(feed.source).toContain("docs.chain.link");
      expect(feed.verifiedAt).toBe("2026-11-21");
    }
  });

  it("uses unique feed addresses", () => {
    const addresses = new Set(VERIFIED_FEEDS.map((feed) => feed.feedAddress.toLowerCase()));
    expect(addresses.size).toBe(VERIFIED_FEEDS.length);
  });

  it("resolves assets by symbol and fails closed otherwise", () => {
    expect(feedForAsset("tAAPL").feedAddress).toBe(VERIFIED_ADDRESSES["tAAPL"]);
    expect(() => feedForAsset("tMSFT")).toThrow(FeedValidationError);
  });

  it("records the authoritative sources it was verified against", () => {
    expect(FEED_SOURCES.chainlink).toContain("tokenized-equity-feeds/coinbase");
    expect(FEED_SOURCES.directory).toContain("reference-data-directory");
  });
});
