import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DEFAULT_DATABASE_CONFIG, createDatabase, resolveDatabaseConfig } from "../src/index.js";

describe("database configuration", () => {
  it("uses conservative bounded defaults", () => {
    expect(resolveDatabaseConfig({})).toEqual(DEFAULT_DATABASE_CONFIG);
    expect(DEFAULT_DATABASE_CONFIG.max).toBeLessThanOrEqual(50);
    expect(DEFAULT_DATABASE_CONFIG.queryTimeoutMs).toBeGreaterThan(0);
  });

  it("reads pool and timeout overrides from the environment", () => {
    expect(
      resolveDatabaseConfig({
        DATABASE_POOL_MAX: "4",
        DATABASE_POOL_MIN: "1",
        DATABASE_CONNECTION_TIMEOUT_MS: "900",
        DATABASE_IDLE_TIMEOUT_MS: "5000",
        DATABASE_QUERY_TIMEOUT_MS: "1500",
        DATABASE_STATEMENT_TIMEOUT_MS: "1400",
      }),
    ).toEqual({
      max: 4,
      min: 1,
      connectionTimeoutMillis: 900,
      idleTimeoutMillis: 5000,
      queryTimeoutMs: 1500,
      statementTimeoutMs: 1400,
    });
  });

  it("rejects invalid or unbounded pool settings", () => {
    expect(() => resolveDatabaseConfig({ DATABASE_POOL_MAX: "0" })).toThrow();
    expect(() => resolveDatabaseConfig({ DATABASE_POOL_MAX: "1000" })).toThrow();
    expect(() => resolveDatabaseConfig({ DATABASE_QUERY_TIMEOUT_MS: "0" })).toThrow();
  });

  it("applies bounds to the actual pg pool without connecting", async () => {
    const handle = createDatabase("postgres://unused/kyrox", {
      max: 1,
      connectionTimeoutMillis: 500,
      queryTimeoutMs: 600,
      statementTimeoutMs: 600,
    });
    const options = (handle.pool as unknown as { options: Record<string, unknown> }).options;
    expect(options["max"]).toBe(1);
    expect(options["connectionTimeoutMillis"]).toBe(500);
    expect(options["query_timeout"]).toBe(600);
    expect(options["statement_timeout"]).toBe(600);
    await handle.pool.end();
  });

  it("prefers a direct database URL for Drizzle migrations", () => {
    const config = readFileSync(
      fileURLToPath(new URL("../drizzle.config.ts", import.meta.url)),
      "utf8",
    );
    expect(config).toContain('process.env["DIRECT_DATABASE_URL"]');
    expect(config.indexOf('process.env["DIRECT_DATABASE_URL"]')).toBeLessThan(
      config.indexOf('process.env["DATABASE_URL"]'),
    );
  });
});
