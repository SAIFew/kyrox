import type { Database } from "@kyrox/db";
import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import { isReadyForTraffic } from "../app/api/status/readiness.js";
import { statusAfterConfirmations } from "../lib/server/activity.js";
import {
  DrizzleIntentStore,
  canTransitionIntentStatus,
  classifyTransactionAssociation,
  type TradeIntentRecord,
  type TradeIntentStatus,
} from "../lib/server/stores.js";

const TX_HASH = `0x${"ab".repeat(32)}` as const;
const OTHER_TX_HASH = `0x${"cd".repeat(32)}` as const;
const CRITICAL_IDS = new Set(["manifest", "database", "markets", "contracts"]);

function readinessChecks(overrides: Record<string, string> = {}) {
  return [
    { id: "manifest", status: "operational" },
    { id: "database", status: "operational" },
    { id: "markets", status: "operational" },
    { id: "contracts", status: "operational" },
    { id: "publication", status: "simulated" },
  ].map((entry) => ({ ...entry, status: overrides[entry.id] ?? entry.status }));
}

function updateHarness(rows: Array<Record<string, unknown>> = []) {
  const state: {
    values: Record<string, unknown> | undefined;
    condition: SQL | undefined;
  } = { values: undefined, condition: undefined };
  const builder = {
    set(values: Record<string, unknown>) {
      state.values = values;
      return builder;
    },
    where(condition: SQL) {
      state.condition = condition;
      return builder;
    },
    async returning(_fields?: unknown) {
      return rows;
    },
  };
  const db = { update: vi.fn(() => builder) };
  const store = new DrizzleIntentStore(db as unknown as Database["db"]);
  return { store, state };
}

function associationRow(
  status: TradeIntentStatus,
  txHash: string | null,
): Pick<TradeIntentRecord, "status" | "txHash"> {
  return { status, txHash };
}

describe("readiness conjunction", () => {
  it("requires every critical check and a healthy publication", () => {
    expect(isReadyForTraffic(readinessChecks(), CRITICAL_IDS)).toBe(true);
    expect(isReadyForTraffic(readinessChecks({ database: "unavailable" }), CRITICAL_IDS)).toBe(
      false,
    );
    expect(isReadyForTraffic(readinessChecks({ markets: "degraded" }), CRITICAL_IDS)).toBe(false);
    expect(isReadyForTraffic(readinessChecks({ publication: "degraded" }), CRITICAL_IDS)).toBe(
      false,
    );
  });

  it("fails closed when a critical check is missing", () => {
    const checks = readinessChecks().filter((entry) => entry.id !== "contracts");
    expect(isReadyForTraffic(checks, CRITICAL_IDS)).toBe(false);
    expect(
      isReadyForTraffic([...checks, { id: "database", status: "operational" }], CRITICAL_IDS),
    ).toBe(false);
  });
});

describe("intent status compare-and-swap rules", () => {
  it("allows forward and evidence-refresh transitions", () => {
    expect(canTransitionIntentStatus("prepared", "verified")).toBe(true);
    expect(canTransitionIntentStatus("submitted", "included")).toBe(true);
    expect(canTransitionIntentStatus("included", "verified")).toBe(true);
    expect(canTransitionIntentStatus("verified", "verified")).toBe(true);
    expect(canTransitionIntentStatus("verified", "reorged")).toBe(true);
  });

  it("never regresses verified, failed, or reorged rows", () => {
    expect(canTransitionIntentStatus("verified", "submitted")).toBe(false);
    expect(canTransitionIntentStatus("verified", "included")).toBe(false);
    expect(canTransitionIntentStatus("verified", "failed")).toBe(false);
    for (const current of ["failed", "reorged"] as const) {
      for (const next of ["submitted", "included", "verified", "failed", "reorged"] as const) {
        expect(canTransitionIntentStatus(current, next)).toBe(false);
      }
    }
  });

  it("uses legal source statuses and an immutable tx-hash guard in SQL", async () => {
    const { store, state } = updateHarness([{ id: "intent-1", status: "included" }]);
    const updated = await store.markStatus("intent-1", "included", {
      txHash: TX_HASH,
      blockNumber: 123n,
      blockHash: `0x${"ef".repeat(32)}`,
    });
    expect(updated).toMatchObject({ id: "intent-1", status: "included" });
    expect(state.values).toMatchObject({
      status: "included",
      txHash: TX_HASH,
      blockNumber: "123",
    });
    expect(state.condition).toBeDefined();
    const query = new PgDialect().sqlToQuery(state.condition!);
    expect(query.sql).toContain('"status" in');
    expect(query.sql).toContain('"tx_hash" is null');
    expect(query.params).toEqual(["intent-1", "prepared", "submitted", "included", TX_HASH]);
    expect(query.params).not.toContain("verified");
  });

  it("returns null when the compare-and-swap loses", async () => {
    const { store } = updateHarness([]);
    await expect(store.markStatus("intent-1", "submitted")).resolves.toBeNull();
  });
});

describe("immutable transaction association", () => {
  it("associates only a prepared row with a null tx hash", async () => {
    const { store, state } = updateHarness([{ id: "intent-1" }]);
    await expect(store.associateTransaction("intent-1", TX_HASH)).resolves.toBe("associated");
    expect(state.values).toMatchObject({ status: "submitted", txHash: TX_HASH });
    const query = new PgDialect().sqlToQuery(state.condition!);
    expect(query.sql).toContain('"tx_hash" is null');
    expect(query.params).toEqual(["intent-1", "prepared"]);
  });

  it("treats the same active transaction as idempotent and rejects replacement", async () => {
    const same = updateHarness([]);
    vi.spyOn(same.store, "get").mockResolvedValue(
      associationRow("verified", TX_HASH) as TradeIntentRecord,
    );
    await expect(same.store.associateTransaction("intent-1", TX_HASH.toUpperCase())).resolves.toBe(
      "already-associated",
    );

    const replacement = updateHarness([]);
    vi.spyOn(replacement.store, "get").mockResolvedValue(
      associationRow("submitted", TX_HASH) as TradeIntentRecord,
    );
    await expect(replacement.store.associateTransaction("intent-1", OTHER_TX_HASH)).resolves.toBe(
      "conflict",
    );
  });

  it("classifies missing, terminal, and unassociated rows safely", () => {
    expect(classifyTransactionAssociation(undefined, TX_HASH)).toBe("not-found");
    expect(classifyTransactionAssociation(associationRow("prepared", null), TX_HASH)).toBe(
      "conflict",
    );
    expect(classifyTransactionAssociation(associationRow("failed", TX_HASH), TX_HASH)).toBe(
      "conflict",
    );
    expect(classifyTransactionAssociation(associationRow("reorged", TX_HASH), TX_HASH)).toBe(
      "conflict",
    );
  });
});

describe("monotonic activity reconciliation", () => {
  it("does not mark a verified row submitted or included on later refreshes", () => {
    expect(statusAfterConfirmations("verified", 0)).toBe("verified");
    expect(statusAfterConfirmations("verified", 1)).toBe("verified");
    expect(statusAfterConfirmations("verified", 2)).toBe("verified");
    expect(statusAfterConfirmations("verified", 3)).toBe("verified");
  });

  it("advances active rows and preserves terminal rows", () => {
    expect(statusAfterConfirmations("submitted", 1)).toBe("included");
    expect(statusAfterConfirmations("submitted", 3)).toBe("verified");
    expect(statusAfterConfirmations("included", 0)).toBe("included");
    expect(statusAfterConfirmations("failed", 10)).toBe("failed");
    expect(statusAfterConfirmations("reorged", 10)).toBe("reorged");
  });
});
