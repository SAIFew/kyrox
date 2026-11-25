import { describe, expect, it } from "vitest";
import { keccak256, toHex } from "viem";

import {
  formatHumanDeploymentPlan,
  redactRpcSecrets,
  redactRpcUrl,
} from "../../../scripts/deploy-sepolia.js";
import { buildDeploymentPlan, type ContractArtifactInfo } from "../src/index.js";

const artifact = (name: string): ContractArtifactInfo => ({
  name,
  bytecodeHash: keccak256(toHex(name)),
  compilerVersion: "0.8.28",
  optimizer: true,
  optimizerRuns: 200,
  evmVersion: "cancun",
});

const plan = buildDeploymentPlan({
  roles: {
    admin: "0x1111111111111111111111111111111111111111",
    priceUpdater: "0x2222222222222222222222222222222222222222",
    pauser: "0x3333333333333333333333333333333333333333",
    deployer: "0x4444444444444444444444444444444444444444",
  },
  assets: [
    {
      symbol: "tAAPL",
      name: "Test Apple",
      decimals: 18,
      feedAddress: "0x5555555555555555555555555555555555555555",
      feedDescription: "Coinbase AAPL",
      sourceChainId: 8453,
      verifiedAt: "2026-11-21",
      maxSourceAgeSeconds: 3_600,
      minPriceUsdcPerWholeToken: 1n,
      maxPriceUsdcPerWholeToken: 10n ** 12n,
      maxPriceDeviationBps: 500,
    },
  ],
  artifacts: {
    TestUSDC: artifact("TestUSDC"),
    TestStock: artifact("TestStock"),
    KyroxExchange: artifact("KyroxExchange"),
  },
  createdAt: "2026-11-21T00:00:00.000Z",
});

const SECRET_RPC_URL =
  "https://rpc-user:rpc-password@rpc.example.com:8545/v1/SECRET_PATH?api_key=SECRET_KEY#fragment";

describe("deployment dry-run RPC redaction", () => {
  it("keeps only the scheme and host in human-readable output", () => {
    const output = formatHumanDeploymentPlan(plan, SECRET_RPC_URL);

    expect(output).toContain("RPC: https://rpc.example.com:8545");
    expect(output).not.toContain("rpc-user");
    expect(output).not.toContain("rpc-password");
    expect(output).not.toContain("SECRET_PATH");
    expect(output).not.toContain("SECRET_KEY");
    expect(output).not.toContain("fragment");
  });

  it("redacts known RPC URLs from propagated error messages", () => {
    const secondary = "https://secondary:secondary-secret@backup.example.com/rpc";
    const message = redactRpcSecrets(
      `primary failed: ${SECRET_RPC_URL}; secondary failed: ${secondary}`,
      [SECRET_RPC_URL, secondary],
    );

    expect(message).toBe(
      "primary failed: https://rpc.example.com:8545; secondary failed: https://backup.example.com",
    );
    expect(message).not.toContain("rpc-password");
    expect(message).not.toContain("secondary-secret");
  });

  it("fails closed for malformed or hostless URLs", () => {
    expect(redactRpcUrl("not a URL")).toBe("[redacted]");
    expect(redactRpcUrl("file:///tmp/rpc-secret")).toBe("[redacted]");
    expect(redactRpcUrl("")).toBe("[redacted]");
  });

  it("does not add RPC URLs to the JSON plan consumed by CI", () => {
    const json = JSON.stringify(plan, null, 2);

    expect(json).not.toContain(SECRET_RPC_URL);
    expect(json).not.toContain("rpc.example.com");
    expect(json).not.toContain("SECRET_KEY");
    expect(JSON.parse(json)).toMatchObject({
      chainId: 84_532,
      roles: plan.roles,
      steps: plan.steps,
    });
  });
});
