import { describe, expect, it } from "vitest";

import { assessFreshness, type PriceObservation } from "@kyrox/core";

import { createDemoQuote } from "../lib/demo/quote.js";
import { defaultDemoLedger, type DemoSession } from "../lib/demo/session.js";
import {
  TESTNET_MAX_SOURCE_AGE_SECONDS,
  defaultTestnetFreshnessConfig,
  isObservationFresh,
} from "../lib/server/freshness.js";

const NOW = 1_800_000_000;
const ADDRESS = "0x1111111111111111111111111111111111111111" as const;

function observation(sourceUpdatedAt: number): PriceObservation {
  return {
    assetSymbol: "tAAPL",
    priceUsdcPerWholeToken: 250_000_000n,
    sourceRoundId: 7n,
    sourceUpdatedAt,
    observedAt: sourceUpdatedAt,
    sourceChainId: 8_453,
    feedAddress: null,
    sourceKind: "simulated",
  };
}

const config = {
  assetSymbol: "tAAPL",
  maxSourceAgeSeconds: TESTNET_MAX_SOURCE_AGE_SECONDS,
  requireOpenMarket: false,
} as const;

describe("600-second testnet freshness default", () => {
  it("exports a ten-minute bootstrap default", () => {
    expect(TESTNET_MAX_SOURCE_AGE_SECONDS).toBe(600);
    expect(defaultTestnetFreshnessConfig("tAAPL")).toEqual({
      assetSymbol: "tAAPL",
      maxSourceAgeSeconds: 600,
      requireOpenMarket: false,
    });
  });

  it("accepts exactly 600 seconds of age and rejects 601", () => {
    expect(assessFreshness(observation(NOW - 600), config, NOW, "open")).toMatchObject({
      fresh: true,
      ageSeconds: 600,
      reason: "ok",
    });
    expect(assessFreshness(observation(NOW - 601), config, NOW, "open")).toMatchObject({
      fresh: false,
      ageSeconds: 601,
      reason: "stale",
    });
    expect(isObservationFresh(NOW, NOW - 600, 600)).toBe(true);
    expect(isObservationFresh(NOW, NOW - 601, 600)).toBe(false);
  });

  it("keeps future and missing-bound checks fail-closed", () => {
    expect(() => assessFreshness(observation(NOW + 1), config, NOW, "open")).toThrowError(
      expect.objectContaining({ code: "FUTURE_TIMESTAMP" }),
    );
    expect(isObservationFresh(NOW, NOW + 1, 600)).toBe(false);
    expect(isObservationFresh(NOW, NOW - 10, null)).toBe(false);
    expect(isObservationFresh(NOW, NOW - 10, 0)).toBe(false);
  });

  it("keeps demo observations inside the testnet freshness ceiling", () => {
    const session: DemoSession = {
      address: ADDRESS,
      expiresAt: NOW + 3_600,
      demo: true,
      ledger: defaultDemoLedger(),
    };
    const quote = createDemoQuote({
      session,
      symbol: "tAAPL",
      side: "buy",
      amountIn: 10_000_000n,
      slippageBps: 50,
      now: NOW,
    });
    expect(quote.expiresAt).toBe(NOW + 30);
    expect(NOW - quote.sourceUpdatedAt).toBeLessThanOrEqual(TESTNET_MAX_SOURCE_AGE_SECONDS);
  });
});
