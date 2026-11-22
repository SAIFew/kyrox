export { FEED_SOURCES, VERIFIED_FEEDS, feedForAsset } from "./feeds/registry.js";
export type { EvmReadClient, FeedConfig, RawFeedObservation } from "./feeds/types.js";
export { FeedValidationError, SOURCE_CHAIN_ID } from "./feeds/types.js";
export type { FeedValidationCode, LatestRoundData } from "./feeds/types.js";
export { ChainlinkFeedReader, isFeedValidationError } from "./feeds/chainlink.js";
export type { FeedReader } from "./feeds/chainlink.js";
export { createBaseMainnetReadClient, createBaseSepoliaReadClient } from "./feeds/viem-client.js";
export type { SepoliaChainReader } from "./feeds/viem-client.js";

export { MAX_REFERENCE_PRICE, USDC_DECIMALS, normalizeChainlinkAnswer } from "./normalize.js";

export {
  BASE_SEQUENCER_DESCRIPTION,
  BASE_SEQUENCER_UPTIME_FEED,
  ChainlinkSequencerUptimeReader,
  SEQUENCER_GRACE_PERIOD_SECONDS,
  SequencerValidationError,
  describeSequencerStatus,
} from "./feeds/sequencer.js";
export type {
  SequencerErrorCode,
  SequencerStatus,
  SequencerUptimeReader,
} from "./feeds/sequencer.js";

export { PriceIngestionWorker } from "./ingestion/worker.js";
export type { IngestionDeps, IngestionLogger, IngestionSummary } from "./ingestion/worker.js";

export { DrizzleObservationStore } from "./persistence/drizzle-store.js";
export { InMemoryObservationStore } from "./persistence/types.js";
export type {
  IngestionEvent,
  IngestionOutcome,
  ObservationInsert,
  ObservationStatus,
  ObservationStore,
  PublicationRecord,
} from "./persistence/types.js";

export { PublicationError, prepareSetPricePublication } from "./publication/prepare.js";
export type { PreparePublicationParams, PreparedPublication } from "./publication/prepare.js";

export const PRICE_SERVICE = {
  name: "kyrox-price",
  sourceChainEnv: "base-mainnet",
  publishChainEnv: "base-sepolia",
  status: "phase-1-read-only-ingestion",
} as const;
