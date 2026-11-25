import { describe, expect, it } from "vitest";

import { feedForAsset } from "../src/feeds/registry.js";
import { InMemoryObservationStore, type ObservationInsert } from "../src/persistence/types.js";

const NOW = 1_795_000_000;
const FEED = feedForAsset("tAAPL").feedAddress;
const OTHER_FEED = "0x1111111111111111111111111111111111111111" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

function record(overrides: Partial<ObservationInsert> = {}): ObservationInsert {
  return {
    assetSymbol: "tAAPL",
    sourceChainId: 8453,
    feedAddress: FEED,
    rawAnswer: 23_000_000_000n,
    feedDecimals: 8,
    sourceRoundId: 100n,
    sourceUpdatedAt: NOW - 60,
    observedAt: NOW,
    referencePriceUsdcPerWholeToken: 230_000_000n,
    sourceDescription: "Coinbase AAPL",
    status: "valid",
    ...overrides,
  };
}

describe("latestValidObservation canonical ordering", () => {
  it("does not regress when an older source round is ingested later", async () => {
    const store = new InMemoryObservationStore();
    await store.insertObservation(record({ sourceRoundId: 101n, sourceUpdatedAt: NOW - 30 }));
    await store.insertObservation(
      record({ sourceRoundId: 100n, sourceUpdatedAt: NOW - 60, observedAt: NOW + 60 }),
    );
    expect((await store.latestValidObservation("tAAPL"))?.sourceRoundId).toBe(101n);
  });

  it("orders equal source timestamps by round and then insertion id", async () => {
    const store = new InMemoryObservationStore();
    await store.insertObservation(record({ sourceRoundId: 100n, feedAddress: FEED }));
    await store.insertObservation(record({ sourceRoundId: 101n, feedAddress: OTHER_FEED }));
    expect((await store.latestValidObservation("tAAPL"))?.sourceRoundId).toBe(101n);

    await store.insertObservation(record({ sourceRoundId: 101n, feedAddress: FEED }));
    expect((await store.latestValidObservation("tAAPL"))?.feedAddress).toBe(FEED);
  });

  it("constrains selection to the expected feed case-insensitively", async () => {
    const store = new InMemoryObservationStore();
    await store.insertObservation(
      record({ sourceRoundId: 200n, sourceUpdatedAt: NOW - 1, feedAddress: OTHER_FEED }),
    );
    await store.insertObservation(
      record({ sourceRoundId: 100n, feedAddress: FEED.toLowerCase() as typeof FEED }),
    );
    expect((await store.latestValidObservation("tAAPL", FEED))?.sourceRoundId).toBe(100n);
    expect(await store.latestValidObservation("tAAPL", ZERO)).toBeNull();
  });
});
