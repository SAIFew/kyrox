import { describe, expect, it, vi } from "vitest";

import { PriceIngestionWorker } from "../src/ingestion/worker.js";
import type { FeedReader } from "../src/feeds/chainlink.js";
import { feedForAsset } from "../src/feeds/registry.js";
import type { FeedConfig, RawFeedObservation } from "../src/feeds/types.js";
import type { SequencerStatus, SequencerUptimeReader } from "../src/feeds/sequencer.js";
import { FeedValidationError } from "../src/feeds/types.js";
import {
  InMemoryObservationStore,
  type IngestionEvent,
  type ObservationInsert,
  type ObservationStore,
} from "../src/persistence/types.js";

const NOW = 1_795_000_000;
const feed = feedForAsset("tAAPL");

const observation: RawFeedObservation = {
  assetSymbol: "tAAPL",
  referenceSymbol: "AAPL",
  feedAddress: feed.feedAddress,
  sourceChainId: 8453,
  sourceDescription: "Coinbase AAPL",
  feedDecimals: 8,
  rawAnswer: 34_529_769_685n,
  sourceRoundId: 100n,
  sourceUpdatedAt: NOW - 60,
  observedAt: NOW,
  referencePriceUsdcPerWholeToken: 345_297_696n,
};

function readerReturning(value: RawFeedObservation | Error): FeedReader {
  return {
    read: async () => {
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

function worker(
  reader: FeedReader,
  store: ObservationStore,
  feeds: readonly FeedConfig[] = [feed],
): PriceIngestionWorker {
  return new PriceIngestionWorker({ feeds, reader, store, nowSeconds: () => NOW });
}

describe("PriceIngestionWorker", () => {
  it("publishes a new valid round once and preserves the source timestamp", async () => {
    const store = new InMemoryObservationStore();
    const summary = await worker(readerReturning(observation), store).runOnce();

    expect(summary).toEqual({ published: 1, duplicates: 0, invalid: 0, errors: 0, blocked: 0 });
    expect(store.observations).toHaveLength(1);
    const stored = store.observations[0] as ObservationInsert;
    expect(stored.status).toBe("valid");
    expect(stored.sourceRoundId).toBe(100n);
    expect(stored.sourceUpdatedAt).toBe(NOW - 60);
    expect(stored.observedAt).toBe(NOW);
    expect(stored.sourceUpdatedAt).not.toBe(stored.observedAt);
    expect(stored.referencePriceUsdcPerWholeToken).toBe(345_297_696n);
    expect(store.events.map((event) => event.outcome)).toEqual(["published"]);
  });

  it("treats an unchanged round as a duplicate and keeps one row", async () => {
    const store = new InMemoryObservationStore();
    const first = await worker(readerReturning(observation), store).runOnce();
    const second = await worker(readerReturning(observation), store).runOnce();

    expect(first.published).toBe(1);
    expect(second).toEqual({ published: 0, duplicates: 1, invalid: 0, errors: 0, blocked: 0 });
    expect(store.observations).toHaveLength(1);
    expect(store.events.map((event) => event.outcome)).toEqual(["published", "duplicate"]);
  });

  it("records a genuinely new round separately", async () => {
    const store = new InMemoryObservationStore();
    await worker(readerReturning(observation), store).runOnce();
    const next = { ...observation, sourceRoundId: 101n, rawAnswer: 34_600_000_000n };
    const summary = await worker(readerReturning(next), store).runOnce();

    expect(summary.published).toBe(1);
    expect(store.observations).toHaveLength(2);
    expect(store.observations[1]?.sourceRoundId).toBe(101n);
    expect(store.observations[0]?.sourceRoundId).toBe(100n);
  });

  it("is safe to restart with a fresh worker over the same store", async () => {
    const store = new InMemoryObservationStore();
    await worker(readerReturning(observation), store).runOnce();
    await worker(readerReturning(observation), store).runOnce();
    expect(store.observations).toHaveLength(1);
  });

  it("records an invalid observation without overwriting the valid one", async () => {
    const store = new InMemoryObservationStore();
    await worker(readerReturning(observation), store).runOnce();

    const invalid = new FeedValidationError("NON_POSITIVE_ANSWER", "Answer must be positive.", {
      sourceRoundId: 101n,
      rawAnswer: 0n,
      feedDecimals: 8,
      sourceUpdatedAt: NOW - 10,
      sourceDescription: "Coinbase AAPL",
    });

    const summary = await worker(readerReturning(invalid), store).runOnce();
    expect(summary).toEqual({ published: 0, duplicates: 0, invalid: 1, errors: 0, blocked: 0 });
    expect(store.observations).toHaveLength(2);
    expect(store.observations[1]?.status).toBe("invalid");
    expect(store.observations[1]?.referencePriceUsdcPerWholeToken).toBeNull();
    expect(store.observations[0]?.status).toBe("valid");
    expect(store.events.map((event) => event.outcome)).toEqual(["published", "invalid"]);
  });

  it("records invalid events even when no partial snapshot exists", async () => {
    const store = new InMemoryObservationStore();
    const error = new FeedValidationError("MISSING_CONTRACT", "No code at feed.");
    const summary = await worker(readerReturning(error), store).runOnce();

    expect(summary.invalid).toBe(1);
    expect(store.observations).toHaveLength(0);
    expect(store.events[0]?.outcome).toBe("invalid");
    expect(store.events[0]?.message).toContain("MISSING_CONTRACT");
  });

  it("records RPC failures and continues with the next asset", async () => {
    const store = new InMemoryObservationStore();
    const failing: FeedReader = {
      read: vi.fn(async (config: FeedConfig) => {
        if (config.assetSymbol === "tAAPL") throw new Error("rpc unavailable");
        return { ...observation, assetSymbol: config.assetSymbol };
      }),
    };
    const feeds = [feed, feedForAsset("tTSLA")];
    const summary = await worker(failing, store, feeds).runOnce();

    expect(summary).toEqual({ published: 1, duplicates: 0, invalid: 0, errors: 1, blocked: 0 });
    expect(store.events.map((event) => event.outcome)).toEqual(["rpc_error", "published"]);
    expect(store.events[0]?.message).toContain("rpc unavailable");
  });

  it("surfaces database write failures as explicit store errors", async () => {
    const events: IngestionEvent[] = [];
    const failingStore: ObservationStore = {
      insertObservation: async () => {
        throw new Error("connection refused");
      },
      recordEvent: async (event) => {
        events.push(event);
      },
      latestValidObservation: async () => null,
      isPublished: async () => false,
      latestPublishedRoundId: async () => null,
      recordPublication: async () => "inserted",
      getPublication: async () => null,
      updatePublication: async () => undefined,
      publicationTransitions: async () => [],
    };

    const summary = await worker(readerReturning(observation), failingStore).runOnce();
    expect(summary).toEqual({ published: 0, duplicates: 0, invalid: 0, errors: 1, blocked: 0 });
    expect(events[0]?.outcome).toBe("store_error");
    expect(events[0]?.message).toContain("connection refused");
  });

  it("skips disabled feeds", async () => {
    const store = new InMemoryObservationStore();
    const summary = await worker(readerReturning(observation), store, [
      { ...feed, enabled: false },
    ]).runOnce();
    expect(summary).toEqual({ published: 0, duplicates: 0, invalid: 0, errors: 0, blocked: 0 });
    expect(store.observations).toHaveLength(0);
  });

  it("starts and stops without leaving a running timer", () => {
    const w = worker(readerReturning(observation), new InMemoryObservationStore());
    expect(w.running).toBe(false);
    w.start(60_000);
    expect(w.running).toBe(true);
    w.stop();
    expect(w.running).toBe(false);
    expect(() => w.start(0)).toThrow();
  });
});

const healthySequencer: SequencerStatus = {
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

function sequencer(read: () => Promise<SequencerStatus>): SequencerUptimeReader {
  return { read };
}

describe("PriceIngestionWorker sequencer gate", () => {
  it("reads feeds when the sequencer is up and past the grace period", async () => {
    const store = new InMemoryObservationStore();
    const workerWithGate = new PriceIngestionWorker({
      feeds: [feed],
      reader: readerReturning(observation),
      store,
      nowSeconds: () => NOW,
      sequencer: sequencer(async () => healthySequencer),
    });
    const summary = await workerWithGate.runOnce();
    expect(summary).toEqual({ published: 1, duplicates: 0, invalid: 0, errors: 0, blocked: 0 });
  });

  it("refuses every feed while the sequencer is down", async () => {
    const store = new InMemoryObservationStore();
    const reader = readerReturning(observation);
    const readSpy = vi.spyOn(reader, "read");
    const workerWithGate = new PriceIngestionWorker({
      feeds: [feed, feedForAsset("tTSLA")],
      reader,
      store,
      nowSeconds: () => NOW,
      sequencer: sequencer(async () => ({ ...healthySequencer, answer: 1, healthy: false })),
    });

    const summary = await workerWithGate.runOnce();
    expect(readSpy).not.toHaveBeenCalled();
    expect(summary).toEqual({ published: 0, duplicates: 0, invalid: 0, errors: 0, blocked: 2 });
    expect(store.observations).toHaveLength(0);
    expect(store.events.map((event) => event.outcome)).toEqual([
      "sequencer_blocked",
      "sequencer_blocked",
    ]);
    expect(store.events[0]?.message).toContain("sequencer=down");
    expect(store.events[0]?.message).toContain("round=");
  });

  it("fails closed when the sequencer check itself errors", async () => {
    const store = new InMemoryObservationStore();
    const workerWithGate = new PriceIngestionWorker({
      feeds: [feed],
      reader: readerReturning(observation),
      store,
      nowSeconds: () => NOW,
      sequencer: sequencer(async () => {
        throw new Error("sequencer rpc unavailable");
      }),
    });

    const summary = await workerWithGate.runOnce();
    expect(summary).toEqual({ published: 0, duplicates: 0, invalid: 0, errors: 1, blocked: 1 });
    expect(store.events[0]?.outcome).toBe("sequencer_error");
    expect(store.events[0]?.message).toContain("sequencer rpc unavailable");
  });

  it("does not count disabled feeds as blocked", async () => {
    const store = new InMemoryObservationStore();
    const workerWithGate = new PriceIngestionWorker({
      feeds: [{ ...feed, enabled: false }],
      reader: readerReturning(observation),
      store,
      nowSeconds: () => NOW,
      sequencer: sequencer(async () => ({
        ...healthySequencer,
        healthy: false,
        gracePeriodElapsed: false,
      })),
    });
    const summary = await workerWithGate.runOnce();
    expect(summary.blocked).toBe(0);
  });
});

describe("PriceIngestionWorker scheduling", () => {
  it("coalesces concurrent runOnce calls onto one cycle", async () => {
    const store = new InMemoryObservationStore();
    let resolveRead: ((value: RawFeedObservation) => void) | undefined;
    const read = vi.fn(
      () =>
        new Promise<RawFeedObservation>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const w = new PriceIngestionWorker({
      feeds: [feed],
      reader: { read },
      store,
      nowSeconds: () => NOW,
    });

    const first = w.runOnce();
    const second = w.runOnce();
    expect(read).toHaveBeenCalledTimes(1);

    resolveRead?.(observation);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(store.observations).toHaveLength(1);
  });

  it("never overlaps a slow cycle with the next scheduled cycle", async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryObservationStore();
      let resolveRead: ((value: RawFeedObservation) => void) | undefined;
      const read = vi.fn(
        () =>
          new Promise<RawFeedObservation>((resolve) => {
            resolveRead = resolve;
          }),
      );
      const w = new PriceIngestionWorker({
        feeds: [feed],
        reader: { read },
        store,
        nowSeconds: () => NOW,
      });

      w.start(1_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(read).toHaveBeenCalledTimes(1);

      // The first cycle is still pending: advancing the interval must not start another.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(read).toHaveBeenCalledTimes(1);

      resolveRead?.(observation);
      await vi.advanceTimersByTimeAsync(0);
      expect(store.observations).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(read).toHaveBeenCalledTimes(2);

      resolveRead?.(observation);
      w.stop();
      await w.drain();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops scheduling after shutdown and drains the in-flight cycle", async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryObservationStore();
      let resolveRead: ((value: RawFeedObservation) => void) | undefined;
      const read = vi.fn(
        () =>
          new Promise<RawFeedObservation>((resolve) => {
            resolveRead = resolve;
          }),
      );
      const w = new PriceIngestionWorker({
        feeds: [feed],
        reader: { read },
        store,
        nowSeconds: () => NOW,
      });

      w.start(1_000);
      await vi.advanceTimersByTimeAsync(0);
      w.stop();
      expect(w.running).toBe(false);

      resolveRead?.(observation);
      await w.drain();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(read).toHaveBeenCalledTimes(1);
      expect(store.observations).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
