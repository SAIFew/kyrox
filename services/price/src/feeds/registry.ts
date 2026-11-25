import type { Address } from "@kyrox/core";

import type { EvmReadClient, FeedConfig, RawFeedObservation } from "./types.js";
import { FeedValidationError, SOURCE_CHAIN_ID } from "./types.js";

const CHAINLINK_DOCS = "https://docs.chain.link/data-feeds/tokenized-equity-feeds/coinbase";
const BASE_DOCS = "https://docs.base.org/build-on-base/integrate-defi/list-tokenized-stocks";
const REFERENCE_DIRECTORY =
  "https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-base-1.json";

/**
 * Verified Coinbase tokenized-equity feeds on Base Mainnet.
 *
 * Every address below was read from Chainlink's reference data directory and the
 * Base documentation. The tAAPL/tTSLA/tNVDA entries were confirmed on Base
 * Mainnet on 2026-11-21: code present, `decimals() == 8`, matching
 * `description()`, positive answer, `answeredInRound == roundId`. The
 * AMZN/GOOGL/META/MSFT entries were confirmed read-only on 2026-11-25:
 * `decimals() == 8` with a matching `description()` on Base Mainnet.
 *
 * The synthetic testnet assets are NOT Coinbase B20 tokens. These entries only
 * bind each synthetic asset to the reference feed whose value it mirrors.
 *
 * Other verified feeds (MSTR, SNDK, SPCX, INTC, COIN, CRCL) exist but have no
 * corresponding synthetic asset, so they are not listed.
 * 24/7 variants exist for GOOGL, NVDA and TSLA; they are deliberately not
 * enabled because the product has not decided to trade outside equity hours.
 */
export const VERIFIED_FEEDS: readonly FeedConfig[] = [
  {
    assetSymbol: "tAAPL",
    referenceSymbol: "AAPL",
    feedAddress: "0x787f13dEa48Db0897CbCDD985de77809D837F988",
    expectedChainId: SOURCE_CHAIN_ID,
    expectedDecimals: 8,
    expectedDescription: "Coinbase AAPL",
    source: `${CHAINLINK_DOCS} ; ${BASE_DOCS}`,
    verifiedAt: "2026-11-21",
    enabled: true,
  },
  {
    assetSymbol: "tTSLA",
    referenceSymbol: "TSLA",
    feedAddress: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4",
    expectedChainId: SOURCE_CHAIN_ID,
    expectedDecimals: 8,
    expectedDescription: "Coinbase TSLA",
    source: `${CHAINLINK_DOCS} ; ${BASE_DOCS}`,
    verifiedAt: "2026-11-21",
    enabled: true,
  },
  {
    assetSymbol: "tNVDA",
    referenceSymbol: "NVDA",
    feedAddress: "0x04689a41629776563E6822F76f2e57D148d28513",
    expectedChainId: SOURCE_CHAIN_ID,
    expectedDecimals: 8,
    expectedDescription: "Coinbase NVDA",
    source: `${CHAINLINK_DOCS} ; ${BASE_DOCS}`,
    verifiedAt: "2026-11-21",
    enabled: true,
  },
  {
    assetSymbol: "tAMZN",
    referenceSymbol: "AMZN",
    feedAddress: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295",
    expectedChainId: SOURCE_CHAIN_ID,
    expectedDecimals: 8,
    expectedDescription: "Coinbase AMZN",
    source: `${CHAINLINK_DOCS} ; ${BASE_DOCS}`,
    verifiedAt: "2026-11-25",
    enabled: true,
  },
  {
    assetSymbol: "tGOOGL",
    referenceSymbol: "GOOGL",
    feedAddress: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2",
    expectedChainId: SOURCE_CHAIN_ID,
    expectedDecimals: 8,
    expectedDescription: "Coinbase GOOGL",
    source: `${CHAINLINK_DOCS} ; ${BASE_DOCS}`,
    verifiedAt: "2026-11-25",
    enabled: true,
  },
  {
    assetSymbol: "tMETA",
    referenceSymbol: "META",
    feedAddress: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D",
    expectedChainId: SOURCE_CHAIN_ID,
    expectedDecimals: 8,
    expectedDescription: "Coinbase META",
    source: `${CHAINLINK_DOCS} ; ${BASE_DOCS}`,
    verifiedAt: "2026-11-25",
    enabled: true,
  },
  {
    assetSymbol: "tMSFT",
    referenceSymbol: "MSFT",
    feedAddress: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c",
    expectedChainId: SOURCE_CHAIN_ID,
    expectedDecimals: 8,
    expectedDescription: "Coinbase MSFT",
    source: `${CHAINLINK_DOCS} ; ${BASE_DOCS}`,
    verifiedAt: "2026-11-25",
    enabled: true,
  },
];

export function feedForAsset(
  assetSymbol: string,
  feeds: readonly FeedConfig[] = VERIFIED_FEEDS,
): FeedConfig {
  const feed = feeds.find((candidate) => candidate.assetSymbol === assetSymbol);
  if (feed === undefined) {
    throw new FeedValidationError(
      "FEED_DISABLED",
      `No verified Chainlink feed is configured for ${assetSymbol}.`,
    );
  }
  return feed;
}

export const FEED_SOURCES = {
  chainlink: CHAINLINK_DOCS,
  base: BASE_DOCS,
  directory: REFERENCE_DIRECTORY,
} as const;

export type { EvmReadClient, FeedConfig, RawFeedObservation };
export type { Address };
