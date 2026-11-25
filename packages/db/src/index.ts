import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDatabase>;

export interface DatabaseConfig {
  readonly max: number;
  readonly min: number;
  readonly connectionTimeoutMillis: number;
  readonly idleTimeoutMillis: number;
  readonly queryTimeoutMs: number;
  readonly statementTimeoutMs: number;
}

export const DEFAULT_DATABASE_CONFIG: Readonly<DatabaseConfig> = Object.freeze({
  max: 10,
  min: 0,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  queryTimeoutMs: 10_000,
  statementTimeoutMs: 10_000,
});

function integerSetting(
  env: Readonly<Record<string, string | undefined>>,
  names: readonly string[],
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = names
    .map((name) => env[name])
    .find((value) => value !== undefined && value.trim() !== "");
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${names[0]} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

/**
 * Resolve bounded pool and timeout settings. Invalid configuration fails closed
 * instead of silently creating an unbounded or indefinitely hanging pool.
 */
export function resolveDatabaseConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DatabaseConfig {
  const max = integerSetting(
    env,
    ["DATABASE_POOL_MAX", "PGPOOL_MAX"],
    DEFAULT_DATABASE_CONFIG.max,
    1,
    50,
  );
  const min = integerSetting(
    env,
    ["DATABASE_POOL_MIN", "PGPOOL_MIN"],
    DEFAULT_DATABASE_CONFIG.min,
    0,
    max,
  );
  return {
    max,
    min,
    connectionTimeoutMillis: integerSetting(
      env,
      ["DATABASE_CONNECTION_TIMEOUT_MS"],
      DEFAULT_DATABASE_CONFIG.connectionTimeoutMillis,
      100,
      60_000,
    ),
    idleTimeoutMillis: integerSetting(
      env,
      ["DATABASE_IDLE_TIMEOUT_MS"],
      DEFAULT_DATABASE_CONFIG.idleTimeoutMillis,
      1_000,
      300_000,
    ),
    queryTimeoutMs: integerSetting(
      env,
      ["DATABASE_QUERY_TIMEOUT_MS"],
      DEFAULT_DATABASE_CONFIG.queryTimeoutMs,
      100,
      60_000,
    ),
    statementTimeoutMs: integerSetting(
      env,
      ["DATABASE_STATEMENT_TIMEOUT_MS"],
      DEFAULT_DATABASE_CONFIG.statementTimeoutMs,
      100,
      60_000,
    ),
  };
}

function validateOverrides(config: DatabaseConfig): DatabaseConfig {
  const values = Object.values(config);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("Database pool and timeout overrides must be non-negative integers.");
  }
  if (config.max < 1 || config.max > 50 || config.min < 0 || config.min > config.max) {
    throw new Error("Database pool size must satisfy 1 <= max <= 50 and 0 <= min <= max.");
  }
  if (
    config.connectionTimeoutMillis < 100 ||
    config.connectionTimeoutMillis > 60_000 ||
    config.idleTimeoutMillis < 1_000 ||
    config.idleTimeoutMillis > 300_000 ||
    config.queryTimeoutMs < 100 ||
    config.queryTimeoutMs > 60_000 ||
    config.statementTimeoutMs < 100 ||
    config.statementTimeoutMs > 60_000
  ) {
    throw new Error("Database timeout override is outside the supported bounded range.");
  }
  return config;
}

/**
 * Create a PostgreSQL connection pool and Drizzle client.
 *
 * Callers own the returned pool and must close it during shutdown. The
 * connection string must come from the server-side environment, never from a
 * `NEXT_PUBLIC_` variable. Optional overrides are intended for short-lived
 * readiness probes that need tighter bounds than normal request traffic.
 */
export function createDatabase(connectionString: string, overrides: Partial<DatabaseConfig> = {}) {
  if (!connectionString.trim()) {
    throw new Error("DATABASE_URL is required to create a database connection.");
  }

  const config = validateOverrides({ ...resolveDatabaseConfig(), ...overrides });
  const pool = new Pool({
    connectionString,
    max: config.max,
    min: config.min,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    idleTimeoutMillis: config.idleTimeoutMillis,
    query_timeout: config.queryTimeoutMs,
    statement_timeout: config.statementTimeoutMs,
    application_name: "kyrox-web",
    keepAlive: true,
    maxUses: 7_500,
  });
  const db = drizzle(pool, { schema });

  return { db, pool, config };
}

export { schema };
export {
  adminAuditLog,
  adminRoles,
  appEvents,
  appUsers,
  authNonces,
  authSessions,
  feedbackEntries,
  indexedClaims,
  indexedTrades,
  indexerCheckpoints,
  issuedQuotes,
  pointsEntries,
  policyConfig,
  priceIngestionEvents,
  priceObservations,
  pricePublicationTransitions,
  pricePublications,
  referrals,
  tradeIntents,
  userEvents,
} from "./schema.js";
export type {
  AdminAuditRow,
  AdminRoleRow,
  AppUserRow,
  FeedbackRow,
  IndexedClaimRow,
  IndexedTradeRow,
  IndexerCheckpointRow,
  NewAdminAuditRow,
  NewAdminRoleRow,
  NewAppUserRow,
  NewFeedbackRow,
  NewIndexedClaimRow,
  NewIndexedTradeRow,
  NewIndexerCheckpointRow,
  NewPointsEntryRow,
  NewPriceIngestionEventRow,
  NewPriceObservationRow,
  NewPricePublicationRow,
  NewPricePublicationTransitionRow,
  NewReferralRow,
  NewUserEventRow,
  PointsEntryRow,
  PolicyConfigRow,
  PriceIngestionEventRow,
  PriceObservationRow,
  PricePublicationRow,
  PricePublicationTransitionRow,
  ReferralRow,
  UserEventRow,
} from "./schema.js";

export * from "./platform.js";
