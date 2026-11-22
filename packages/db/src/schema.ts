import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * One validated or rejected source observation.
 *
 * `sourceUpdatedAt` is the ORIGINAL feed timestamp. `observedAt` is when our
 * worker read it. They are deliberately separate columns so publication and
 * reporting can never launder one into the other.
 *
 * Amounts are `numeric(78,0)` strings, never floating point.
 */
export const priceObservations = pgTable(
  "price_observations",
  {
    id: serial("id").primaryKey(),
    assetSymbol: text("asset_symbol").notNull(),
    sourceChainId: integer("source_chain_id").notNull(),
    feedAddress: text("feed_address").notNull(),
    rawAnswer: numeric("raw_answer", { precision: 78, scale: 0 }).notNull(),
    feedDecimals: smallint("feed_decimals").notNull(),
    sourceRoundId: numeric("source_round_id", { precision: 78, scale: 0 }).notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true, mode: "date" }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" }).notNull(),
    referencePriceUsdcPerWholeToken: numeric("reference_price_usdc_per_whole_token", {
      precision: 78,
      scale: 0,
    }),
    sourceDescription: text("source_description").notNull(),
    status: text("status", { enum: ["valid", "invalid"] }).notNull(),
    validationError: text("validation_error"),
  },
  (table) => [
    uniqueIndex("price_observations_source_round_unique").on(
      table.sourceChainId,
      table.feedAddress,
      table.sourceRoundId,
    ),
    index("price_observations_asset_observed_idx").on(table.assetSymbol, table.observedAt),
    check("price_observations_status_check", sql`${table.status} in ('valid','invalid')`),
  ],
);

/**
 * Retrieval audit trail.
 *
 * Every poll for every asset produces exactly one row: success, duplicate,
 * invalid, or rpc_error. Failures are data, not silence.
 */
export const priceIngestionEvents = pgTable(
  "price_ingestion_events",
  {
    id: serial("id").primaryKey(),
    assetSymbol: text("asset_symbol").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" }).notNull(),
    outcome: text("outcome", {
      enum: [
        "published",
        "duplicate",
        "invalid",
        "rpc_error",
        "store_error",
        "sequencer_blocked",
        "sequencer_error",
      ],
    }).notNull(),
    sourceRoundId: numeric("source_round_id", { precision: 78, scale: 0 }),
    message: text("message"),
  },
  (table) => [index("price_ingestion_events_asset_idx").on(table.assetSymbol, table.observedAt)],
);

/**
 * Prepared (never signed, never sent) Sepolia publications.
 *
 * The unique index makes a duplicate round idempotent at the database level.
 */
export const pricePublications = pgTable(
  "price_publications",
  {
    id: serial("id").primaryKey(),
    assetSymbol: text("asset_symbol").notNull(),
    sourceRoundId: numeric("source_round_id", { precision: 78, scale: 0 }).notNull(),
    exchangeAddress: text("exchange_address").notNull(),
    calldataHash: text("calldata_hash").notNull(),
    preparedAt: timestamp("prepared_at", { withTimezone: true, mode: "date" }).notNull(),
    status: text("status", {
      enum: [
        "prepared",
        "submitted",
        "included",
        "confirmed",
        "verified",
        "failed",
        "verification_failed",
        "reorged",
      ],
    })
      .notNull()
      .default("prepared"),
    // Immutable snapshot of the observation the calldata was built from.
    stockToken: text("stock_token"),
    referencePriceUsdcPerWholeToken: numeric("reference_price_usdc_per_whole_token", {
      precision: 78,
      scale: 0,
    }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true, mode: "date" }),
    sourceChainId: integer("source_chain_id"),
    feedAddress: text("feed_address"),
    simulated: boolean("simulated"),
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" }),
    // Lifecycle / inclusion evidence.
    transactionHash: text("transaction_hash"),
    blockNumber: numeric("block_number", { precision: 78, scale: 0 }),
    blockHash: text("block_hash"),
    confirmations: integer("confirmations"),
    includedAt: timestamp("included_at", { withTimezone: true, mode: "date" }),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
    failureReason: text("failure_reason"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true, mode: "date" }),
    reorgDetected: boolean("reorg_detected").notNull().default(false),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true, mode: "date" }),
    artifactHash: text("artifact_hash"),
    artifactJson: text("artifact_json"),
  },
  (table) => [
    uniqueIndex("price_publications_asset_round_unique").on(table.assetSymbol, table.sourceRoundId),
    uniqueIndex("price_publications_transaction_unique").on(table.transactionHash),
    check(
      "price_publications_status_check",
      sql`${table.status} in ('prepared','submitted','included','confirmed','verified','failed','verification_failed','reorged')`,
    ),
  ],
);

export type PriceObservationRow = typeof priceObservations.$inferSelect;
export type NewPriceObservationRow = typeof priceObservations.$inferInsert;
export type PriceIngestionEventRow = typeof priceIngestionEvents.$inferSelect;
export type NewPriceIngestionEventRow = typeof priceIngestionEvents.$inferInsert;
export type PricePublicationRow = typeof pricePublications.$inferSelect;
export type PricePublicationTransitionRow = typeof pricePublicationTransitions.$inferSelect;
export type NewPricePublicationTransitionRow = typeof pricePublicationTransitions.$inferInsert;
export type NewPricePublicationRow = typeof pricePublications.$inferInsert;

/**
 * Append-only publication transition history. Verification state changes are
 * auditable even when a concurrent verifier loses a compare-and-swap race.
 */
export const pricePublicationTransitions = pgTable(
  "price_publication_transitions",
  {
    id: serial("id").primaryKey(),
    assetSymbol: text("asset_symbol").notNull(),
    sourceRoundId: numeric("source_round_id", { precision: 78, scale: 0 }).notNull(),
    fromStatus: text("from_status").notNull(),
    toStatus: text("to_status").notNull(),
    transactionHash: text("transaction_hash"),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    index("price_publication_transitions_lookup_idx").on(
      table.assetSymbol,
      table.sourceRoundId,
      table.occurredAt,
    ),
  ],
);

/** One-time wallet-authentication challenges. Consumed atomically on verify. */
export const authNonces = pgTable("auth_nonces", {
  nonce: text("nonce").primaryKey(),
  address: text("address"),
  issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
});

/** Hashed wallet-authenticated sessions; the raw cookie is never stored. */
export const authSessions = pgTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  address: text("address").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
});

/** Server-issued, wallet-bound, HMAC-authenticated quotes. */
export const issuedQuotes = pgTable(
  "issued_quotes",
  {
    id: text("id").primaryKey(),
    trader: text("trader").notNull(),
    assetSymbol: text("asset_symbol").notNull(),
    quoteJson: text("quote_json").notNull(),
    observationJson: text("observation_json").notNull(),
    freshnessJson: text("freshness_json").notNull(),
    boundsJson: text("bounds_json").notNull(),
    marketSession: text("market_session").notNull(),
    maxSlippageBps: integer("max_slippage_bps").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    used: boolean("used").notNull().default(false),
  },
  (table) => [index("issued_quotes_trader_idx").on(table.trader, table.issuedAt)],
);

/** Unsigned trade intents prepared from an authenticated issued quote. */
export const tradeIntents = pgTable(
  "trade_intents",
  {
    id: text("id").primaryKey(),
    quoteId: text("quote_id").notNull(),
    trader: text("trader").notNull(),
    assetSymbol: text("asset_symbol").notNull(),
    side: text("side", { enum: ["buy", "sell"] }).notNull(),
    amountIn: numeric("amount_in", { precision: 78, scale: 0 }).notNull(),
    minAmountOut: numeric("min_amount_out", { precision: 78, scale: 0 }).notNull(),
    deadline: numeric("deadline", { precision: 78, scale: 0 }).notNull(),
    calldata: text("calldata").notNull(),
    intentHash: text("intent_hash").notNull(),
    txHash: text("tx_hash"),
    blockNumber: numeric("block_number", { precision: 78, scale: 0 }),
    blockHash: text("block_hash"),
    status: text("status", {
      enum: ["prepared", "submitted", "included", "verified", "failed", "reorged"],
    })
      .notNull()
      .default("prepared"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    index("trade_intents_trader_idx").on(table.trader, table.createdAt),
    uniqueIndex("trade_intents_quote_unique").on(table.quoteId),
  ],
);

/** Structured, secret-free operational events for monitoring and review. */
export const appEvents = pgTable(
  "app_events",
  {
    id: serial("id").primaryKey(),
    level: text("level", { enum: ["info", "warn", "error"] }).notNull(),
    event: text("event").notNull(),
    message: text("message").notNull(),
    context: text("context"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [index("app_events_event_idx").on(table.event, table.createdAt)],
);
