import { fileURLToPath } from "node:url";

import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase } from "@kyrox/db";

import { DrizzleObservationStore } from "../src/persistence/drizzle-store.js";
import { PublicationTransitionError } from "../src/persistence/types.js";
import type { ObservationInsert } from "../src/persistence/types.js";

const connectionString = process.env["KYROX_TEST_DATABASE_URL"] ?? "";
const enabled = connectionString.length > 0;

const migrationsFolder = fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url));

const record: ObservationInsert = {
  assetSymbol: "tAAPL",
  sourceChainId: 8453,
  feedAddress: "0x787f13dEa48Db0897CbCDD985de77809D837F988",
  rawAnswer: 34_529_769_685n,
  feedDecimals: 8,
  sourceRoundId: 100n,
  sourceUpdatedAt: 1_795_272_445,
  observedAt: 1_795_272_505,
  referencePriceUsdcPerWholeToken: 345_297_696n,
  sourceDescription: "Coinbase AAPL",
  status: "valid",
};

/**
 * Real PostgreSQL integration suite.
 *
 * Skipped unless KYROX_TEST_DATABASE_URL points at a disposable database. This
 * is the only test that exercises Drizzle against a live server; the unit tests
 * use in-memory fakes and must not be described as PostgreSQL coverage.
 */
describe.skipIf(!enabled)("PostgreSQL observation store", () => {
  let handle: ReturnType<typeof createDatabase>;
  let store: DrizzleObservationStore;

  beforeAll(async () => {
    handle = createDatabase(connectionString);
    await migrate(handle.db, { migrationsFolder });
    store = new DrizzleObservationStore(handle.db);
  }, 60_000);

  beforeEach(async () => {
    await handle.db.execute(
      sql`TRUNCATE TABLE "price_observations", "price_ingestion_events", "price_publications", "price_publication_transitions" RESTART IDENTITY CASCADE`,
    );
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it("applies the real migration and exposes the unique index", async () => {
    const result = await handle.pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'price_observations'`,
    );
    const names = result.rows.map((row) => row.indexname);
    expect(names).toContain("price_observations_source_round_unique");
    expect(names).toContain("price_observations_asset_observed_idx");
  });

  it("inserts a round once and reports duplicates", async () => {
    expect(await store.insertObservation(record)).toBe("inserted");
    expect(await store.insertObservation(record)).toBe("duplicate");

    const count = await handle.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM price_observations`,
    );
    expect(count.rows[0]?.count).toBe("1");
  });

  it("preserves the original source timestamp and history", async () => {
    await store.insertObservation(record);
    await store.insertObservation({ ...record, sourceRoundId: 101n, rawAnswer: 34_600_000_000n });

    const latest = await store.latestValidObservation("tAAPL");
    expect(latest?.sourceRoundId).toBe(101n);
    expect(latest?.sourceUpdatedAt).toBe(record.sourceUpdatedAt);
    expect(latest?.observedAt).toBe(record.observedAt);

    const rows = await handle.pool.query<{ source_updated_at: Date; observed_at: Date }>(
      `SELECT source_updated_at, observed_at FROM price_observations ORDER BY id`,
    );
    expect(rows.rows).toHaveLength(2);
    for (const row of rows.rows) {
      expect(row.source_updated_at.getTime()).toBe(record.sourceUpdatedAt * 1000);
    }
  });

  it("orders by canonical source timestamp/round/id and never regresses on late ingestion", async () => {
    await store.insertObservation(record);
    await store.insertObservation({ ...record, sourceRoundId: 101n, rawAnswer: 34_600_000_000n });
    await store.insertObservation({
      ...record,
      sourceRoundId: 102n,
      sourceUpdatedAt: record.sourceUpdatedAt - 60,
      observedAt: record.observedAt + 60,
    });
    expect((await store.latestValidObservation("tAAPL"))?.sourceRoundId).toBe(101n);

    const otherFeed = "0x1111111111111111111111111111111111111111" as const;
    await store.insertObservation({
      ...record,
      feedAddress: otherFeed,
      sourceRoundId: 200n,
      sourceUpdatedAt: record.sourceUpdatedAt + 1,
    });
    expect((await store.latestValidObservation("tAAPL"))?.sourceRoundId).toBe(200n);
    expect((await store.latestValidObservation("tAAPL", record.feedAddress))?.sourceRoundId).toBe(
      101n,
    );
  });

  it("never overwrites a valid observation with an invalid one for the same round", async () => {
    await store.insertObservation(record);
    expect(
      await store.insertObservation({
        ...record,
        status: "invalid",
        referencePriceUsdcPerWholeToken: null,
        validationError: "NON_POSITIVE_ANSWER: test",
      }),
    ).toBe("duplicate");

    const row = await handle.pool.query<{ status: string }>(
      `SELECT status FROM price_observations WHERE source_round_id = '100'`,
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]?.status).toBe("valid");
  });

  it("serialises concurrent attempts into one insert", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => store.insertObservation({ ...record, sourceRoundId: 200n })),
    );
    expect(results.filter((result) => result === "inserted")).toHaveLength(1);
    expect(results.filter((result) => result === "duplicate")).toHaveLength(9);

    const count = await handle.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM price_observations`,
    );
    expect(count.rows[0]?.count).toBe("1");
  });

  it("is restart-safe across store instances", async () => {
    await store.insertObservation(record);
    const restarted = new DrizzleObservationStore(handle.db);
    expect(await restarted.insertObservation(record)).toBe("duplicate");
  });

  it("tracks publication lifecycle and never downgrades a verified row", async () => {
    const hash = `0x${"ab".repeat(32)}` as const;
    expect(
      await store.recordPublication({
        assetSymbol: "tAAPL",
        sourceRoundId: 400n,
        exchangeAddress: "0x1111111111111111111111111111111111111111",
        calldataHash: hash,
        preparedAt: record.observedAt,
        stockToken: "0x2222222222222222222222222222222222222222",
        referencePriceUsdcPerWholeToken: 230_000_000n,
        sourceUpdatedAt: record.sourceUpdatedAt,
        sourceChainId: 8_453,
        feedAddress: "0x0000000000000000000000000000000000000000",
        simulated: true,
        observedAt: record.observedAt,
        artifactHash: "",
        artifactJson: "",
      }),
    ).toBe("inserted");

    const prepared = await store.getPublication("tAAPL", 400n);
    expect(prepared?.status).toBe("prepared");
    expect(prepared?.calldataHash).toBe(hash);

    await store.updatePublication({
      assetSymbol: "tAAPL",
      sourceRoundId: 400n,
      status: "verified",
      transactionHash: `0x${"cd".repeat(32)}`,
      blockNumber: "100",
      blockHash: `0x${"ef".repeat(32)}`,
      confirmations: 5,
      verifiedAt: record.observedAt,
    });
    expect((await store.getPublication("tAAPL", 400n))?.status).toBe("verified");

    await expect(
      store.updatePublication({
        assetSymbol: "tAAPL",
        sourceRoundId: 400n,
        status: "verification_failed",
        failureReason: "reorg",
      }),
    ).rejects.toBeInstanceOf(PublicationTransitionError);
    expect((await store.getPublication("tAAPL", 400n))?.status).toBe("verified");

    await store.updatePublication({
      assetSymbol: "tAAPL",
      sourceRoundId: 400n,
      status: "reorged",
      failureReason: "block hash changed",
      invalidatedAt: record.observedAt,
    });
    const reorged = await store.getPublication("tAAPL", 400n);
    expect(reorged?.status).toBe("reorged");
    expect(reorged?.reorgDetected).toBe(true);
    expect(reorged?.verifiedAt).toBeDefined();

    const history = await store.publicationTransitions("tAAPL", 400n);
    expect(history.map((entry) => entry.toStatus)).toEqual(["verified", "reorged"]);
  });

  it("records ingestion events for audit", async () => {
    await store.recordEvent({
      assetSymbol: "tAAPL",
      observedAt: record.observedAt,
      outcome: "invalid",
      sourceRoundId: 300n,
      message: "test",
    });
    const events = await handle.pool.query<{ outcome: string }>(
      `SELECT outcome FROM price_ingestion_events`,
    );
    expect(events.rows[0]?.outcome).toBe("invalid");
  });

  it("rejects writes when the database is unreachable", async () => {
    const broken = createDatabase("postgres://kyrox:kyrox@127.0.0.1:59999/kyrox_missing");
    const brokenStore = new DrizzleObservationStore(broken.db);
    await expect(brokenStore.insertObservation(record)).rejects.toBeTruthy();
    await broken.pool.end().catch(() => undefined);
  }, 30_000);
});
