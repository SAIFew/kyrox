import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  appDatabase: vi.fn(),
}));

vi.mock("@/lib/server/database", () => ({
  appDatabase: state.appDatabase,
}));

import { GET as healthz } from "../app/api/healthz/route.js";
import { GET as readyz } from "../app/api/readyz/route.js";

beforeEach(() => {
  state.query.mockReset();
  state.appDatabase.mockReset();
  state.appDatabase.mockReturnValue({ pool: { query: state.query } });
  vi.stubEnv("KYROX_DEMO_MODE", "0");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("liveness and readiness endpoints", () => {
  it("reports liveness without configuration details", async () => {
    const response = await healthz();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("reports ready when PostgreSQL answers in live mode", async () => {
    state.query.mockResolvedValue({ rows: [{ "?column?": 1 }] });
    const response = await readyz();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ready" });
  });

  it("returns a generic 503 when PostgreSQL is unavailable", async () => {
    state.query.mockRejectedValue(
      new Error("connect ECONNREFUSED postgres://user:secret@db.internal:5432/kyrox"),
    );
    const response = await readyz();
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain("Service is not ready.");
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("db.internal");
    expect(text).not.toContain("postgres://");
    expect(text).not.toContain("secret");
  });

  it("returns a generic 503 when configuration or pool creation fails", async () => {
    state.appDatabase.mockImplementation(() => {
      throw new Error("DATABASE_URL missing at /srv/kyrox/.env");
    });
    const response = await readyz();
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toContain("DATABASE_URL");
    expect(text).not.toContain("/srv/kyrox");
  });

  it("is ready in preview mode without a database when the session secret is valid", async () => {
    vi.stubEnv("KYROX_DEMO_MODE", "1");
    vi.stubEnv("KYROX_DEMO_SECRET", "demo-secret-for-tests-0123456789abcdef");
    const response = await readyz();
    expect(response.status).toBe(200);
    expect(state.appDatabase).not.toHaveBeenCalled();
  });

  it("fails closed in production preview mode without a signed-session secret", async () => {
    vi.stubEnv("KYROX_DEMO_MODE", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KYROX_DEMO_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "");
    const response = await readyz();
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toContain("AUTH_SECRET");
    expect(text).not.toContain("KYROX_DEMO_SECRET");
  });
});
