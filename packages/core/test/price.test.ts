import { describe, expect, it } from "vitest";

import {
  CoreError,
  assessFreshness,
  assertPriceObservation,
  isSimulatedPrice,
  type AssetFreshnessConfig,
  type PriceObservation,
} from "../src/index.js";

const NOW = 1_700_000_000;

const observation: PriceObservation = {
  assetSymbol: "tAAPL",
  priceUsdcPerWholeToken: 230_000_000n,
  sourceRoundId: 42n,
  sourceUpdatedAt: NOW - 30,
  observedAt: NOW - 25,
  sourceChainId: 8453,
  feedAddress: "0x0000000000000000000000000000000000000001",
  sourceKind: "chainlink-coinbase",
};

const config: AssetFreshnessConfig = {
  assetSymbol: "tAAPL",
  maxSourceAgeSeconds: 60,
  requireOpenMarket: true,
};

describe("price observation validation", () => {
  it("accepts a valid observation", () => {
    expect(assertPriceObservation(observation, NOW)).toBe(observation);
  });

  it("rejects zero and negative prices", () => {
    expect(() =>
      assertPriceObservation({ ...observation, priceUsdcPerWholeToken: 0n }, NOW),
    ).toThrow(CoreError);
  });

  it("rejects zero round ids", () => {
    expect(() => assertPriceObservation({ ...observation, sourceRoundId: 0n }, NOW)).toThrow(
      CoreError,
    );
  });

  it("rejects zero and future source timestamps", () => {
    expect(() => assertPriceObservation({ ...observation, sourceUpdatedAt: 0 }, NOW)).toThrow(
      CoreError,
    );
    try {
      assertPriceObservation({ ...observation, sourceUpdatedAt: NOW + 1 }, NOW);
    } catch (error) {
      expect((error as CoreError).code).toBe("FUTURE_TIMESTAMP");
    }
  });

  it("requires a feed address for chainlink observations", () => {
    expect(() => assertPriceObservation({ ...observation, feedAddress: null }, NOW)).toThrow(
      CoreError,
    );
    expect(() =>
      assertPriceObservation({ ...observation, feedAddress: null, sourceKind: "simulated" }, NOW),
    ).not.toThrow();
  });
});

describe("freshness", () => {
  it("accepts a price within the per-asset age bound while the market is open", () => {
    const result = assessFreshness(observation, config, NOW, "open");
    expect(result).toMatchObject({ fresh: true, ageSeconds: 30, reason: "ok" });
  });

  it("rejects a price older than the asset bound", () => {
    const stale = { ...observation, sourceUpdatedAt: NOW - 61 };
    expect(assessFreshness(stale, config, NOW, "open").reason).toBe("stale");
  });

  it("rejects a weekend-style closed market even when the value looks recent", () => {
    expect(assessFreshness(observation, config, NOW, "closed").reason).toBe("market-closed");
    expect(assessFreshness(observation, config, NOW, "unknown").reason).toBe("market-unknown");
  });

  it("allows a 24/7 feed asset to ignore market sessions when configured", () => {
    const alwaysOn: AssetFreshnessConfig = { ...config, requireOpenMarket: false };
    expect(assessFreshness(observation, alwaysOn, NOW, "closed").fresh).toBe(true);
  });

  it("uses per-asset bounds, not one global rule", () => {
    const strict: AssetFreshnessConfig = { ...config, maxSourceAgeSeconds: 10 };
    expect(assessFreshness(observation, config, NOW, "open").fresh).toBe(true);
    expect(assessFreshness(observation, strict, NOW, "open").fresh).toBe(false);
  });

  it("rejects an invalid clock or an invalid bound", () => {
    expect(() => assessFreshness(observation, config, 0, "open")).toThrow(CoreError);
    expect(() =>
      assessFreshness(observation, { ...config, maxSourceAgeSeconds: 0 }, NOW, "open"),
    ).toThrow(CoreError);
  });

  it("refuses freshness config for a different asset", () => {
    expect(() =>
      assessFreshness(observation, { ...config, assetSymbol: "tTSLA" }, NOW, "open"),
    ).toThrow(CoreError);
  });

  it("labels simulated prices so they are never presented as chainlink data", () => {
    const simulated: PriceObservation = {
      ...observation,
      feedAddress: null,
      sourceKind: "simulated",
      priceUsdcPerWholeToken: 230_000_000n,
    };
    expect(isSimulatedPrice(simulated)).toBe(true);
    expect(isSimulatedPrice(observation)).toBe(false);
  });
});
