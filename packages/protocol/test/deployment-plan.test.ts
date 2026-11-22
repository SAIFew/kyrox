import { describe, expect, it } from "vitest";
import type { Hex } from "viem";

import {
  DeploymentPlanError,
  assertDeploymentChain,
  buildDeploymentPlan,
  parseDeploymentManifest,
  type ContractArtifactInfo,
} from "../src/index.js";

const ADMIN = "0x1111111111111111111111111111111111111111" as const;
const UPDATER = "0x2222222222222222222222222222222222222222" as const;
const PAUSER = "0x3333333333333333333333333333333333333333" as const;
const DEPLOYER = "0x5555555555555555555555555555555555555555" as const;
const FEED = "0x4444444444444444444444444444444444444444" as const;

const artifact = (name: string): ContractArtifactInfo => ({
  name,
  bytecodeHash: `0x${"ab".repeat(32)}` as Hex,
  compilerVersion: "0.8.28",
  optimizer: true,
  optimizerRuns: 200,
  evmVersion: "cancun",
});

const input = {
  roles: { admin: ADMIN, priceUpdater: UPDATER, pauser: PAUSER, deployer: DEPLOYER },
  assets: [
    {
      symbol: "tAAPL",
      name: "Test Apple",
      decimals: 18,
      feedAddress: FEED,
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
};

describe("deployment chain guard", () => {
  it("accepts only Base Sepolia", () => {
    expect(() => assertDeploymentChain(84_532)).not.toThrow();
    expect(() => assertDeploymentChain(8_453)).toThrow(DeploymentPlanError);
    expect(() => assertDeploymentChain(31_337)).toThrow(DeploymentPlanError);
    expect(() => assertDeploymentChain(1)).toThrow(DeploymentPlanError);
  });
});

describe("deployment plan", () => {
  it("orders stablecoin, stocks, then exchange with real constructor shapes", () => {
    const plan = buildDeploymentPlan(input);
    expect(plan.steps.map((step) => step.contractName)).toEqual([
      "TestUSDC",
      "TestStock:tAAPL",
      "KyroxExchange",
    ]);
    expect(plan.steps[0]?.constructorArgs).toEqual([ADMIN]);
    expect(plan.steps[1]?.constructorArgs).toEqual(["Test Apple", "tAAPL", 18, ADMIN]);
    expect(plan.steps[2]?.constructorArgs).toEqual(["{{TestUSDC}}", ADMIN]);
    expect(plan.steps[2]?.dependencies).toEqual(["TestUSDC"]);
  });

  it("includes role grants, asset configuration and independent keys", () => {
    const plan = buildDeploymentPlan(input);
    expect(plan.roleGrants).toContain(`KyroxExchange.grantRole(PRICE_UPDATER_ROLE, ${UPDATER})`);
    expect(plan.roleGrants).toContain(`KyroxExchange.grantRole(PAUSER_ROLE, ${PAUSER})`);
    expect(plan.assetConfiguration[0]).toContain("maxSourceAge=3600");
    expect(plan.assetConfiguration[0]).toContain("deviation=500bps");
    expect(plan.warnings).toEqual([]);
  });

  it("warns when privileged roles share the admin key", () => {
    const plan = buildDeploymentPlan({
      ...input,
      roles: { admin: ADMIN, priceUpdater: ADMIN, pauser: ADMIN, deployer: DEPLOYER },
    });
    expect(plan.warnings).toHaveLength(2);
  });

  it("produces a planning manifest with no live addresses", () => {
    const plan = buildDeploymentPlan(input);
    const manifest = plan.manifest;
    expect(manifest.environment).toBe("base-sepolia-proposal");
    expect(manifest.status).toBe("not_deployed");
    expect(manifest.planningOnly).toBe(true);
    expect(manifest.chainId).toBe(84_532);
    for (const contract of manifest.contracts) {
      expect(contract.address).toBeNull();
    }
    expect(manifest.assets[0]?.stockToken).toBeNull();
    expect(manifest.assets[0]?.feed.address).toBe(FEED);
  });

  it("must not pass the production deployment-manifest validator", () => {
    const plan = buildDeploymentPlan(input);
    expect(() => parseDeploymentManifest(plan.manifest)).toThrow();
  });

  it("requires an explicit non-zero per-asset deviation", () => {
    expect(() =>
      buildDeploymentPlan({
        ...input,
        assets: [
          { ...(input.assets[0] as (typeof input.assets)[number]), maxPriceDeviationBps: 0 },
        ],
      }),
    ).toThrow(DeploymentPlanError);
  });

  it("records safe gas estimates when provided", () => {
    const plan = buildDeploymentPlan({ ...input, gasEstimates: { TestUSDC: "12345" } });
    expect(plan.steps[0]?.estimatedGas).toBe("12345");
    expect(plan.manifest.contracts[0]?.estimatedGas).toBe("12345");
  });
});
