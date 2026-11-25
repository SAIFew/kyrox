import { createDatabase, DEFAULT_DATABASE_CONFIG } from "@kyrox/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDatabase, closeAppDatabase } from "../lib/server/database.js";

const URL_A = "postgres://user:pass@127.0.0.1:5432/kyrox_a";
const URL_B = "postgres://user:pass@127.0.0.1:5432/kyrox_b";

afterEach(async () => {
  await closeAppDatabase();
});

describe("process-scoped web database pool", () => {
  it("reuses one pool across concurrent callers", () => {
    const handles = Array.from({ length: 24 }, () => appDatabase(URL_A));
    const first = handles[0];
    expect(first).toBeDefined();
    expect(handles.every((handle) => handle === first)).toBe(true);
  });

  it("uses the bounded shared pool configuration", () => {
    const database = appDatabase(URL_A);
    expect(database.config.max).toBe(DEFAULT_DATABASE_CONFIG.max);
    expect(database.config.connectionTimeoutMillis).toBe(
      DEFAULT_DATABASE_CONFIG.connectionTimeoutMillis,
    );
    expect(database.config.idleTimeoutMillis).toBe(DEFAULT_DATABASE_CONFIG.idleTimeoutMillis);
  });

  it("refuses to silently reuse the pool for a different database", () => {
    appDatabase(URL_A);
    expect(() => appDatabase(URL_B)).toThrow(/different connection/);
  });

  it("closes the shared pool explicitly and permits a fresh process pool", async () => {
    const first = appDatabase(URL_A);
    const end = vi.spyOn(first.pool, "end").mockResolvedValue(undefined);
    await closeAppDatabase();
    expect(end).toHaveBeenCalledTimes(1);

    const second = appDatabase(URL_A);
    expect(second).not.toBe(first);
  });

  it("keeps explicit script and test handles independent and closable", async () => {
    const left = createDatabase(URL_A);
    const right = createDatabase(URL_B);
    expect(left.pool).not.toBe(right.pool);
    await left.pool.end();
    await right.pool.end();
  });
});
