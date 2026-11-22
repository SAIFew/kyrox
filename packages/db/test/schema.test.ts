import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../drizzle/0000_price_ingestion.sql", import.meta.url)),
  "utf8",
);
const lifecycleMigration = readFileSync(
  fileURLToPath(new URL("../drizzle/0001_publication_lifecycle.sql", import.meta.url)),
  "utf8",
);
const stateMachineMigration = readFileSync(
  fileURLToPath(new URL("../drizzle/0002_publication_state_machine.sql", import.meta.url)),
  "utf8",
);
const integrityMigration = readFileSync(
  fileURLToPath(new URL("../drizzle/0003_integrity_checks.sql", import.meta.url)),
  "utf8",
);

describe("price ingestion schema", () => {
  it("enforces round uniqueness per feed", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "price_observations_source_round_unique" ON "price_observations" USING btree ("source_chain_id","feed_address","source_round_id")',
    );
  });

  it("enforces publication uniqueness per asset round", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "price_publications_asset_round_unique" ON "price_publications" USING btree ("asset_symbol","source_round_id")',
    );
  });

  it("stores source and retrieval timestamps separately", () => {
    expect(migration).toContain('"source_updated_at" timestamp with time zone NOT NULL');
    expect(migration).toContain('"observed_at" timestamp with time zone NOT NULL');
  });

  it("stores integer money as numeric, never float", () => {
    expect(migration).toContain('"raw_answer" numeric(78, 0) NOT NULL');
    expect(migration).toContain('"reference_price_usdc_per_whole_token" numeric(78, 0)');
    expect(migration).not.toMatch(/\b(real|double precision|float)\b/i);
  });

  it("adds publication lifecycle columns and a transaction uniqueness index", () => {
    for (const column of [
      "stock_token",
      "transaction_hash",
      "block_number",
      "block_hash",
      "confirmations",
      "verified_at",
      "failure_reason",
    ]) {
      expect(lifecycleMigration).toContain(`"${column}"`);
    }
    expect(lifecycleMigration).toContain(
      'CREATE UNIQUE INDEX "price_publications_transaction_unique"',
    );
  });

  it("adds reorg, artifact and transition-history structures", () => {
    for (const column of [
      "reorg_detected",
      "invalidated_at",
      "last_verified_at",
      "artifact_hash",
      "artifact_json",
    ]) {
      expect(stateMachineMigration).toContain(`"${column}"`);
    }
    expect(stateMachineMigration).toContain('CREATE TABLE "price_publication_transitions"');
    expect(stateMachineMigration).toContain(
      'CREATE INDEX "price_publication_transitions_lookup_idx"',
    );
  });

  it("constrains observation and publication statuses in the database", () => {
    expect(integrityMigration).toContain("price_publications_status_check");
    expect(integrityMigration).toContain("price_observations_status_check");
    expect(integrityMigration).toContain("'reorged'");
  });

  it("allows an invalid observation to record a reason", () => {
    expect(migration).toContain('"validation_error" text');
    expect(migration).toContain('"status" text NOT NULL');
  });
});
