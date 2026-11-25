import { describe, expect, it } from "vitest";

import { FEED_SOURCES, VERIFIED_FEEDS, feedForAsset } from "../src/feeds/registry.js";
import { FeedValidationError, SOURCE_CHAIN_ID } from "../src/feeds/types.js";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

const VERIFIED_ADDRESSES: Record<string, string> = {
  tAAPL: "0x787f13dEa48Db0897CbCDD985de77809D837F988",
  tTSLA: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4",
  tNVDA: "0x04689a41629776563E6822F76f2e57D148d28513",
  tAMZN: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295",
  tGOOGL: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2",
  tMETA: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D",
  tMSFT: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c",
};

const VERIFIED_AT: Record<string, string> = {
  tAAPL: "2026-11-21",
  tTSLA: "2026-11-21",
  tNVDA: "2026-11-21",
  tAMZN: "2026-11-25",
  tGOOGL: "2026-11-25",
  tMETA: "2026-11-25",
  tMSFT: "2026-11-25",
};

describe("verified feed registry", () => {
  it("maps every synthetic asset to its verified reference feed", () => {
    expect(VERIFIED_FEEDS).toHaveLength(7);
    for (const feed of VERIFIED_FEEDS) {
      expect(feed.expectedChainId).toBe(SOURCE_CHAIN_ID);
      expect(feed.expectedDecimals).toBe(8);
      expect(feed.enabled).toBe(true);
      expect(feed.feedAddress).toBe(VERIFIED_ADDRESSES[feed.assetSymbol]);
      expect(feed.feedAddress).toMatch(ADDRESS_PATTERN);
      expect(feed.expectedDescription).toBe(`Coinbase ${feed.referenceSymbol}`);
      expect(feed.source).toContain("docs.chain.link");
      expect(feed.verifiedAt).toBe(VERIFIED_AT[feed.assetSymbol]);
    }
  });

  it("uses unique feed addresses", () => {
    const addresses = new Set(VERIFIED_FEEDS.map((feed) => feed.feedAddress.toLowerCase()));
    expect(addresses.size).toBe(VERIFIED_FEEDS.length);
  });

  it("resolves assets by symbol and fails closed otherwise", () => {
    expect(feedForAsset("tAAPL").feedAddress).toBe(VERIFIED_ADDRESSES["tAAPL"]);
    expect(feedForAsset("tMSFT").feedAddress).toBe(VERIFIED_ADDRESSES["tMSFT"]);
    expect(feedForAsset("tMETA").feedAddress).toBe(VERIFIED_ADDRESSES["tMETA"]);
    expect(() => feedForAsset("tDOGE")).toThrow(FeedValidationError);
  });

  it("records the authoritative sources it was verified against", () => {
    expect(FEED_SOURCES.chainlink).toContain("tokenized-equity-feeds/coinbase");
    expect(FEED_SOURCES.directory).toContain("reference-data-directory");
  });
});
