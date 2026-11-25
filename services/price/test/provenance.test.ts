import { describe, expect, it } from "vitest";

import { feedForAsset } from "../src/feeds/registry.js";
import type { ObservationInsert } from "../src/persistence/types.js";
import {
  ObservationProvenanceError,
  assertObservationProvenance,
  validateStoredObservation,
} from "../src/provenance.js";

const NOW = 1_795_000_000;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const feed = feedForAsset("tAAPL");

const record: ObservationInsert = {
  assetSymbol: "tAAPL",
  sourceChainId: 8453,
  feedAddress: feed.feedAddress,
  rawAnswer: 34_529_769_685n,
  feedDecimals: 8,
  sourceRoundId: 100n,
  sourceUpdatedAt: NOW - 60,
  observedAt: NOW,
  referencePriceUsdcPerWholeToken: 345_297_696n,
  sourceDescription: "Coinbase AAPL",
  status: "valid",
};

describe("observation provenance", () => {
  it("derives the real source kind only from the verified feed binding", () => {
    const observation = validateStoredObservation(record, { nowSeconds: NOW });
    expect(observation.sourceKind).toBe("chainlink-coinbase");
    expect(observation.feedAddress).toBe(feed.feedAddress);
    expect(() => assertObservationProvenance(observation, { nowSeconds: NOW })).not.toThrow();
  });

  it("rejects unknown feeds, chains, decimals, descriptions, and rewritten prices", () => {
    const cases: ObservationInsert[] = [
      { ...record, feedAddress: "0x1111111111111111111111111111111111111111" },
      { ...record, sourceChainId: 84_532 },
      { ...record, feedDecimals: 18 },
      { ...record, sourceDescription: "Coinbase TSLA" },
      { ...record, referencePriceUsdcPerWholeToken: 345_297_697n },
      { ...record, status: "invalid" },
    ];
    for (const value of cases) {
      expect(() => validateStoredObservation(value, { nowSeconds: NOW })).toThrow(
        ObservationProvenanceError,
      );
    }
  });

  it("allows a feedless row only in an explicitly simulated runtime", () => {
    const simulated: ObservationInsert = {
      ...record,
      feedAddress: ZERO,
      sourceDescription: "Local simulated reference",
      rawAnswer: 23_000_000_000n,
      referencePriceUsdcPerWholeToken: 230_000_000n,
    };
    expect(() => validateStoredObservation(simulated, { nowSeconds: NOW })).toThrow(
      ObservationProvenanceError,
    );
    const observation = validateStoredObservation(simulated, {
      nowSeconds: NOW,
      allowSimulated: true,
    });
    expect(observation.sourceKind).toBe("simulated");
    expect(observation.feedAddress).toBeNull();
  });

  it("rejects future observations and source-kind tampering", () => {
    expect(() =>
      validateStoredObservation({ ...record, observedAt: NOW + 1 }, { nowSeconds: NOW }),
    ).toThrow(ObservationProvenanceError);
    const observation = validateStoredObservation(record, { nowSeconds: NOW });
    expect(() =>
      assertObservationProvenance(
        { ...observation, sourceKind: "simulated", feedAddress: null },
        { nowSeconds: NOW, allowSimulated: true },
      ),
    ).not.toThrow();
    expect(() =>
      assertObservationProvenance(observation, { nowSeconds: NOW, allowSimulated: false }),
    ).not.toThrow();
    expect(() =>
      assertObservationProvenance(
        { ...observation, feedAddress: "0x1111111111111111111111111111111111111111" },
        { nowSeconds: NOW },
      ),
    ).toThrow(ObservationProvenanceError);
  });
});
