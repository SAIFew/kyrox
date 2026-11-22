import type { Address } from "@kyrox/core";
import {
  DeploymentError,
  assertLocalManifest,
  requireAssetAddress,
  requireExchangeAddress,
  type DeploymentManifest,
} from "@kyrox/protocol";

import type { FeedReader } from "../feeds/chainlink.js";
import { feedForAsset } from "../feeds/registry.js";
import type { SequencerUptimeReader } from "../feeds/sequencer.js";
import { describeSequencerStatus } from "../feeds/sequencer.js";
import { PriceIngestionWorker, type IngestionSummary } from "../ingestion/worker.js";
import type { ObservationStore } from "../persistence/types.js";
import { PublicationError, prepareSetPricePublication } from "../publication/prepare.js";
import type { IngestCliConfig } from "./config.js";

export type PublicationOutcomeStatus = "prepared" | "blocked" | "duplicate" | "rejected";

export interface PublicationOutcome {
  readonly assetSymbol: string;
  readonly status: PublicationOutcomeStatus;
  readonly reason?: string;
  readonly to?: Address;
  readonly calldata?: string;
  readonly calldataHash?: string;
  readonly sourceRoundId?: string;
  readonly sourceUpdatedAt?: number;
  readonly referencePriceUsdcPerWholeToken?: string;
  readonly artifactHash?: string;
  readonly artifactJson?: string;
}

export interface IngestReport {
  readonly mode: "one-shot";
  readonly chainId: 8453;
  readonly sequencer:
    | { readonly checked: true; readonly healthy: true; readonly detail: string }
    | { readonly checked: true; readonly healthy: false; readonly detail: string };
  readonly ingestion: IngestionSummary;
  readonly publications: readonly PublicationOutcome[];
  readonly status: "ok" | "partial" | "blocked" | "failed";
}

export interface IngestDeps {
  readonly reader: FeedReader;
  readonly sequencer: SequencerUptimeReader;
  readonly store: ObservationStore;
  readonly loadManifest: (path: string) => DeploymentManifest | null;
  readonly nowSeconds?: () => number;
  readonly preparePublication?: typeof prepareSetPricePublication;
  readonly logger?: (line: string) => void;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function isZeroAddress(address: string): boolean {
  return address.toLowerCase() === ZERO_ADDRESS;
}

/**
 * Run exactly one ingestion cycle, then prepare unsigned publications for the
 * latest valid observation of each enabled asset.
 *
 * Never signs, sends, or touches a wallet.
 */
export async function runIngestOnce(
  config: IngestCliConfig,
  deps: IngestDeps,
): Promise<IngestReport> {
  const nowSeconds = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const prepare = deps.preparePublication ?? prepareSetPricePublication;
  const feeds = config.assetSymbols.map((symbol) => feedForAsset(symbol));

  const logger = deps.logger ?? (() => undefined);

  const recordSequencerEvents = async (
    outcome: "sequencer_blocked" | "sequencer_error",
    message: string,
  ): Promise<void> => {
    for (const feed of feeds) {
      try {
        await deps.store.recordEvent({
          assetSymbol: feed.assetSymbol,
          observedAt: nowSeconds(),
          outcome,
          message,
        });
      } catch {
        // The report already records the block; a failing audit write must not
        // be reported as a successful cycle.
      }
    }
  };

  let sequencerReport: IngestReport["sequencer"];
  try {
    const status = await deps.sequencer.read();
    const detail = describeSequencerStatus(status);
    if (!status.healthy) {
      await recordSequencerEvents("sequencer_blocked", detail);
      return {
        mode: "one-shot",
        chainId: 8_453,
        sequencer: { checked: true, healthy: false, detail },
        ingestion: { published: 0, duplicates: 0, invalid: 0, errors: 0, blocked: feeds.length },
        publications: [],
        status: "blocked",
      };
    }
    sequencerReport = { checked: true, healthy: true, detail };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await recordSequencerEvents("sequencer_error", detail);
    return {
      mode: "one-shot",
      chainId: 8_453,
      sequencer: { checked: true, healthy: false, detail },
      ingestion: { published: 0, duplicates: 0, invalid: 0, errors: 1, blocked: feeds.length },
      publications: [],
      status: "blocked",
    };
  }

  const worker = new PriceIngestionWorker({
    feeds,
    reader: deps.reader,
    store: deps.store,
    nowSeconds,
    logger: (event) => logger(`${event.level}: ${event.message}`),
  });

  const ingestion = await worker.runOnce();

  const manifest = deps.loadManifest(config.manifestPath);
  const publications: PublicationOutcome[] = [];
  const now = nowSeconds();

  for (const symbol of config.assetSymbols) {
    const latest = await deps.store.latestValidObservation(symbol);
    if (latest === null) {
      publications.push({
        assetSymbol: symbol,
        status: "blocked",
        reason: "no valid observation is stored yet",
      });
      continue;
    }

    if (manifest === null) {
      publications.push({
        assetSymbol: symbol,
        status: "blocked",
        reason: `deployment manifest not found at ${config.manifestPath}`,
      });
      continue;
    }

    try {
      if (manifest.status === "unpopulated") {
        throw new DeploymentError(
          "MISSING_DEPLOYMENT",
          "Deployment manifest is unpopulated; publication is disabled until an approved deployment is recorded.",
        );
      }
      if (manifest.environment === "local-anvil") {
        assertLocalManifest(manifest);
      } else if (manifest.environment !== "base-sepolia") {
        throw new DeploymentError(
          "MISSING_DEPLOYMENT",
          `Manifest environment "${manifest.environment}" is not publishable.`,
        );
      }
      requireExchangeAddress(manifest);
      requireAssetAddress(manifest, symbol);
    } catch (error) {
      publications.push({
        assetSymbol: symbol,
        status: "blocked",
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    try {
      const assetConfig = manifest.assets[symbol];
      const priceBounds =
        assetConfig?.minPriceUsdcPerWholeToken !== undefined &&
        assetConfig.maxPriceUsdcPerWholeToken !== undefined
          ? {
              minPriceUsdcPerWholeToken: BigInt(assetConfig.minPriceUsdcPerWholeToken),
              maxPriceUsdcPerWholeToken: BigInt(assetConfig.maxPriceUsdcPerWholeToken),
            }
          : undefined;
      const lastPublishedRoundId = await deps.store.latestPublishedRoundId(symbol);
      const prepared = await prepare({
        observation: latest,
        stockToken: requireAssetAddress(manifest, symbol),
        manifest,
        store: deps.store,
        nowSeconds: now,
        maxSourceAgeSeconds: assetConfig?.maxSourceAgeSeconds ?? config.maxSourceAgeSeconds,
        ...(priceBounds !== undefined ? { priceBounds } : {}),
        simulated: isZeroAddress(latest.feedAddress),
        ...(lastPublishedRoundId !== null ? { lastPublishedRoundId } : {}),
      });

      publications.push({
        assetSymbol: symbol,
        status: "prepared",
        to: prepared.to,
        calldata: prepared.data,
        calldataHash: prepared.calldataHash,
        sourceRoundId: prepared.sourceRoundId.toString(),
        sourceUpdatedAt: prepared.sourceUpdatedAt,
        referencePriceUsdcPerWholeToken: prepared.referencePriceUsdcPerWholeToken.toString(),
      });
    } catch (error) {
      if (error instanceof PublicationError && error.code === "DUPLICATE_ROUND") {
        publications.push({
          assetSymbol: symbol,
          status: "duplicate",
          reason: error.message,
        });
        continue;
      }
      publications.push({
        assetSymbol: symbol,
        status: "rejected",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const status: IngestReport["status"] =
    ingestion.errors > 0
      ? "partial"
      : publications.some((entry) => entry.status === "rejected")
        ? "partial"
        : "ok";

  return {
    mode: "one-shot",
    chainId: 8_453,
    sequencer: sequencerReport,
    ingestion,
    publications,
    status,
  };
}

/** Process exit code: 0 ok/blocked-by-deployment, 1 partial failure, 3 sequencer blocked. */
export function exitCodeFor(report: IngestReport): number {
  if (report.sequencer.healthy === false) return 3;
  if (report.status === "partial") return 1;
  return 0;
}
