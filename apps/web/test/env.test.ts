import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadEnvironment } from "../lib/server/env.js";

const original = { ...process.env };
const dir = mkdtempSync(join(tmpdir(), "kyrox-env-"));

function manifest(name: string, environment: string, status: string) {
  const path = join(dir, name);
  writeFileSync(
    path,
    JSON.stringify({
      chainId: 84_532,
      chain: "base-sepolia",
      environment,
      status,
      rpc: { url: "http://127.0.0.1:8545" },
      contracts: {
        TestUSDC: { address: "0x1111111111111111111111111111111111111111" },
        KyroxExchange: { address: "0x2222222222222222222222222222222222222222" },
      },
      assets: {
        tAAPL: {
          address: "0x3333333333333333333333333333333333333333",
          maxSourceAgeSeconds: 3600,
          maxPriceDeviationBps: 500,
          minPriceUsdcPerWholeToken: "1",
          maxPriceUsdcPerWholeToken: "1000000000000",
        },
      },
    }),
  );
  return path;
}

afterEach(() => {
  process.env = { ...original };
});

describe("environment separation", () => {
  it("accepts a loopback local-anvil manifest in local mode", () => {
    const path = manifest("local.json", "local-anvil", "local-anvil");
    process.env = {
      ...original,
      KYROX_ENVIRONMENT: "local-anvil",
      DATABASE_URL: "postgres://local/kyrox",
      AUTH_SECRET: "a".repeat(48),
      BASE_SEPOLIA_RPC_URL: "http://127.0.0.1:8545",
      KYROX_DEPLOYMENT_MANIFEST: path,
    };
    expect(loadEnvironment().mode).toBe("local-anvil");
  });

  it("rejects a non-loopback local RPC and a production manifest in local mode", () => {
    const localPath = manifest("local2.json", "local-anvil", "local-anvil");
    process.env = {
      ...original,
      KYROX_ENVIRONMENT: "local-anvil",
      DATABASE_URL: "postgres://local/kyrox",
      AUTH_SECRET: "a".repeat(48),
      BASE_SEPOLIA_RPC_URL: "https://sepolia.example",
      KYROX_DEPLOYMENT_MANIFEST: localPath,
    };
    expect(() => loadEnvironment()).toThrow();

    const productionPath = manifest("prod.json", "base-sepolia", "deployed");
    process.env = {
      ...original,
      KYROX_ENVIRONMENT: "local-anvil",
      DATABASE_URL: "postgres://local/kyrox",
      AUTH_SECRET: "a".repeat(48),
      BASE_SEPOLIA_RPC_URL: "http://127.0.0.1:8545",
      KYROX_DEPLOYMENT_MANIFEST: productionPath,
    };
    expect(() => loadEnvironment()).toThrow();
  });

  it("rejects a local-anvil manifest in production mode", () => {
    const localPath = manifest("local3.json", "local-anvil", "local-anvil");
    process.env = {
      ...original,
      KYROX_ENVIRONMENT: "base-sepolia",
      DATABASE_URL: "postgres://local/kyrox",
      AUTH_SECRET: "a".repeat(48),
      BASE_SEPOLIA_RPC_URL: "https://sepolia.example",
      KYROX_DEPLOYMENT_MANIFEST: localPath,
    };
    expect(() => loadEnvironment()).toThrow();
  });
});

process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
