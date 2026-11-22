import type { FeedConfig, FeedValidationError, RawFeedObservation } from "../feeds/types.js";
import type { FeedReader } from "../feeds/chainlink.js";
import { isFeedValidationError } from "../feeds/chainlink.js";
import type { SequencerStatus, SequencerUptimeReader } from "../feeds/sequencer.js";
import { describeSequencerStatus } from "../feeds/sequencer.js";
import type { ObservationInsert, ObservationStore } from "../persistence/types.js";

export interface IngestionSummary {
  readonly published: number;
  readonly duplicates: number;
  readonly invalid: number;
  readonly errors: number;
  /** Feeds not read because the L2 sequencer gate refused the cycle. */
  readonly blocked: number;
}

export interface IngestionLogger {
  (event: { level: "info" | "warn" | "error"; message: string; assetSymbol?: string }): void;
}

export interface IngestionDeps {
  readonly feeds: readonly FeedConfig[];
  readonly reader: FeedReader;
  readonly store: ObservationStore;
  readonly nowSeconds?: () => number;
  readonly logger?: IngestionLogger;
  /** When supplied, every cycle requires a healthy L2 sequencer first. */
  readonly sequencer?: SequencerUptimeReader;
}

const EMPTY_SUMMARY: IngestionSummary = {
  published: 0,
  duplicates: 0,
  invalid: 0,
  errors: 0,
  blocked: 0,
};

/**
 * Poll-driven ingestion worker.
 *
 * Scheduling is sequential: the next poll is only scheduled after the previous
 * cycle settles, so a slow cycle cannot overlap itself. `runOnce` also coalesces
 * concurrent callers onto the same in-flight promise.
 *
 * Every outcome is persisted: a new valid round, a repeated round, an invalid
 * observation, an RPC failure, a database failure, or a sequencer refusal.
 */
export class PriceIngestionWorker {
  readonly #feeds: readonly FeedConfig[];
  readonly #reader: FeedReader;
  readonly #store: ObservationStore;
  readonly #nowSeconds: () => number;
  readonly #logger: IngestionLogger;
  readonly #sequencer: SequencerUptimeReader | undefined;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #intervalMs = 0;
  #running = false;
  #stopped = true;
  #inFlight: Promise<IngestionSummary> | null = null;

  constructor(deps: IngestionDeps) {
    this.#feeds = deps.feeds;
    this.#reader = deps.reader;
    this.#store = deps.store;
    this.#nowSeconds = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
    this.#logger = deps.logger ?? (() => undefined);
    this.#sequencer = deps.sequencer;
  }

  get running(): boolean {
    return this.#running;
  }

  /** Coalesces concurrent calls; a second caller joins the in-flight cycle. */
  async runOnce(): Promise<IngestionSummary> {
    if (this.#inFlight !== null) return this.#inFlight;

    const cycle = this.#executeCycle().finally(() => {
      this.#inFlight = null;
    });
    this.#inFlight = cycle;
    return cycle;
  }

  start(intervalMs: number): void {
    if (this.#running) return;
    if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
      throw new Error("Ingestion interval must be a positive integer number of milliseconds.");
    }
    this.#intervalMs = intervalMs;
    this.#running = true;
    this.#stopped = false;
    this.#schedule(0);
  }

  /** Stop scheduling new cycles. An in-flight cycle is allowed to finish. */
  stop(): void {
    this.#stopped = true;
    this.#running = false;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** Await the current cycle, if any. Used for graceful shutdown. */
  async drain(): Promise<void> {
    if (this.#inFlight !== null) await this.#inFlight;
  }

  #schedule(delayMs: number): void {
    this.#timer = setTimeout(() => {
      void this.#tick();
    }, delayMs);
  }

  async #tick(): Promise<void> {
    if (this.#stopped) return;
    try {
      await this.runOnce();
    } catch (error) {
      // runOnce isolates per-feed failures; this guards against programme errors
      // so the schedule continues instead of silently dying.
      this.#logger({
        level: "error",
        message: `Ingestion cycle failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    if (!this.#stopped) {
      this.#schedule(this.#intervalMs);
    }
  }

  async #executeCycle(): Promise<IngestionSummary> {
    if (this.#sequencer !== undefined) {
      const gate = await this.#sequencerGate();
      if (gate !== null) return gate;
    }

    let published = 0;
    let duplicates = 0;
    let invalid = 0;
    let errors = 0;

    for (const feed of this.#feeds) {
      if (!feed.enabled) continue;

      let observation: RawFeedObservation;
      try {
        observation = await this.#reader.read(feed);
      } catch (error) {
        if (isFeedValidationError(error)) {
          invalid += 1;
          const inserted = await this.#storeInvalid(feed, error);
          await this.#safeEvent({
            assetSymbol: feed.assetSymbol,
            observedAt: this.#nowSeconds(),
            outcome: "invalid",
            ...(inserted?.sourceRoundId !== undefined
              ? { sourceRoundId: inserted.sourceRoundId }
              : {}),
            message: `${error.code}: ${error.message}`,
          });
        } else {
          errors += 1;
          this.#logger({
            level: "error",
            message: `RPC read failed: ${error instanceof Error ? error.message : String(error)}`,
            assetSymbol: feed.assetSymbol,
          });
          await this.#safeEvent({
            assetSymbol: feed.assetSymbol,
            observedAt: this.#nowSeconds(),
            outcome: "rpc_error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
        continue;
      }

      let outcome: "inserted" | "duplicate";
      try {
        outcome = await this.#storeObservation(observation);
      } catch (error) {
        errors += 1;
        this.#logger({
          level: "error",
          message: `Database write failed: ${error instanceof Error ? error.message : String(error)}`,
          assetSymbol: feed.assetSymbol,
        });
        await this.#safeEvent({
          assetSymbol: feed.assetSymbol,
          observedAt: this.#nowSeconds(),
          outcome: "store_error",
          sourceRoundId: observation.sourceRoundId,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      if (outcome === "inserted") {
        published += 1;
        await this.#safeEvent({
          assetSymbol: feed.assetSymbol,
          observedAt: observation.observedAt,
          outcome: "published",
          sourceRoundId: observation.sourceRoundId,
        });
      } else {
        duplicates += 1;
        await this.#safeEvent({
          assetSymbol: feed.assetSymbol,
          observedAt: observation.observedAt,
          outcome: "duplicate",
          sourceRoundId: observation.sourceRoundId,
          message: "Source round already recorded.",
        });
      }
    }

    const summary = { published, duplicates, invalid, errors, blocked: 0 };
    if (published + duplicates + invalid + errors === 0) return EMPTY_SUMMARY;
    this.#logger({ level: "info", message: `Ingestion run: ${JSON.stringify(summary)}` });
    return summary;
  }

  /** Returns a blocked summary when the sequencer gate refuses the cycle. */
  async #sequencerGate(): Promise<IngestionSummary | null> {
    if (this.#sequencer === undefined) return null;

    const enabled = this.#feeds.filter((feed) => feed.enabled);
    let status: SequencerStatus;
    try {
      status = await this.#sequencer.read();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#logger({ level: "error", message: `Sequencer check failed: ${message}` });
      for (const feed of enabled) {
        await this.#safeEvent({
          assetSymbol: feed.assetSymbol,
          observedAt: this.#nowSeconds(),
          outcome: "sequencer_error",
          message,
        });
      }
      return { ...EMPTY_SUMMARY, errors: 1, blocked: enabled.length };
    }

    if (status.healthy) return null;

    const message = describeSequencerStatus(status);
    this.#logger({ level: "warn", message: `Sequencer gate blocked ingestion: ${message}` });
    for (const feed of enabled) {
      await this.#safeEvent({
        assetSymbol: feed.assetSymbol,
        observedAt: status.observedAt,
        outcome: "sequencer_blocked",
        message,
      });
    }
    return { ...EMPTY_SUMMARY, blocked: enabled.length };
  }

  async #storeObservation(observation: RawFeedObservation): Promise<"inserted" | "duplicate"> {
    const record: ObservationInsert = {
      assetSymbol: observation.assetSymbol,
      sourceChainId: observation.sourceChainId,
      feedAddress: observation.feedAddress,
      rawAnswer: observation.rawAnswer,
      feedDecimals: observation.feedDecimals,
      sourceRoundId: observation.sourceRoundId,
      sourceUpdatedAt: observation.sourceUpdatedAt,
      observedAt: observation.observedAt,
      referencePriceUsdcPerWholeToken: observation.referencePriceUsdcPerWholeToken,
      sourceDescription: observation.sourceDescription,
      status: "valid",
    };
    return this.#store.insertObservation(record);
  }

  async #storeInvalid(
    feed: FeedConfig,
    error: FeedValidationError,
  ): Promise<ObservationInsert | null> {
    const partial = error.partial;
    if (
      partial.sourceRoundId === undefined ||
      partial.rawAnswer === undefined ||
      partial.feedDecimals === undefined ||
      partial.sourceUpdatedAt === undefined ||
      partial.sourceDescription === undefined
    ) {
      return null;
    }

    const record: ObservationInsert = {
      assetSymbol: feed.assetSymbol,
      sourceChainId: feed.expectedChainId,
      feedAddress: feed.feedAddress,
      rawAnswer: partial.rawAnswer,
      feedDecimals: partial.feedDecimals,
      sourceRoundId: partial.sourceRoundId,
      sourceUpdatedAt: partial.sourceUpdatedAt,
      observedAt: this.#nowSeconds(),
      referencePriceUsdcPerWholeToken: null,
      sourceDescription: partial.sourceDescription,
      status: "invalid",
      validationError: `${error.code}: ${error.message}`,
    };

    try {
      await this.#store.insertObservation(record);
      return record;
    } catch (storeError) {
      this.#logger({
        level: "error",
        message: `Failed to persist invalid observation: ${
          storeError instanceof Error ? storeError.message : String(storeError)
        }`,
        assetSymbol: feed.assetSymbol,
      });
      return null;
    }
  }

  async #safeEvent(event: Parameters<ObservationStore["recordEvent"]>[0]): Promise<void> {
    try {
      await this.#store.recordEvent(event);
    } catch (error) {
      this.#logger({
        level: "error",
        message: `Failed to persist ingestion event: ${
          error instanceof Error ? error.message : String(error)
        }`,
        assetSymbol: event.assetSymbol,
      });
    }
  }
}
