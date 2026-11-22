import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256, type Abi, type Hex } from "viem";

import {
  BASE_SEPOLIA_CHECKPOINT_BLOCK,
  BASE_SEPOLIA_CHECKPOINT_HASH,
  BASE_SEPOLIA_GENESIS_HASH,
  ManifestActivationError,
  buildDeploymentPlan,
  buildPendingDeploymentRecord,
  parseDeploymentManifest,
  pendingToManifest,
  promotePendingManifest,
  validatePendingRecord,
  verifyDeployment,
  type DeploymentArtifact,
  type DeploymentEvidence,
  type DeploymentVerifierRpc,
  type PendingDeploymentRecord,
} from "../src/index.js";

const ADMIN = "0x1111111111111111111111111111111111111111" as const;
const UPDATER = "0x2222222222222222222222222222222222222222" as const;
const PAUSER = "0x3333333333333333333333333333333333333333" as const;
const USDC = "0x4444444444444444444444444444444444444444" as const;
const STOCK = "0x5555555555555555555555555555555555555555" as const;
const EXCHANGE = "0x6666666666666666666666666666666666666666" as const;
const FEED = "0x7777777777777777777777777777777777777777" as const;
const OTHER = "0x8888888888888888888888888888888888888888" as const;
const PROPOSAL_HASH = `0x${"12".repeat(32)}` as Hex;
const DEPLOYER = "0x5555555555555555555555555555555555555555" as const;
const BLOCK_HASH = `0x${"bb".repeat(32)}` as Hex;

const baseArtifact = (bytecode: Hex, deployed: Hex): DeploymentArtifact => ({
  abi: [
    {
      type: "constructor",
      inputs: [{ name: "admin", type: "address" }],
      stateMutability: "nonpayable",
    },
  ] as Abi,
  bytecode,
  deployedBytecode: deployed,
  immutableReferences: {},
});

const artifacts: Record<string, DeploymentArtifact> = {
  TestUSDC: baseArtifact("0x6001", `0x${"aa".repeat(40)}` as Hex),
  TestStock: {
    abi: [
      {
        type: "constructor",
        inputs: [
          { name: "name_", type: "string" },
          { name: "symbol_", type: "string" },
          { name: "decimals_", type: "uint8" },
          { name: "admin", type: "address" },
        ],
        stateMutability: "nonpayable",
      },
    ] as Abi,
    bytecode: "0x6002" as Hex,
    deployedBytecode: `0x${"bb".repeat(40)}` as Hex,
    immutableReferences: { "1": [{ start: 0, length: 32 }] },
  },
  KyroxExchange: {
    abi: [
      {
        type: "constructor",
        inputs: [
          { name: "usdc_", type: "address" },
          { name: "admin", type: "address" },
        ],
        stateMutability: "nonpayable",
      },
    ] as Abi,
    bytecode: "0x6003" as Hex,
    deployedBytecode: `0x${"cc".repeat(40)}` as Hex,
    immutableReferences: {},
  },
};

const proposal = buildDeploymentPlan({
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
      maxSourceAgeSeconds: 3600,
      minPriceUsdcPerWholeToken: 1n,
      maxPriceUsdcPerWholeToken: 10n ** 12n,
      maxPriceDeviationBps: 500,
    },
  ],
  artifacts: {
    TestUSDC: {
      name: "TestUSDC",
      bytecodeHash: keccak256(artifacts["TestUSDC"]?.bytecode as Hex),
      compilerVersion: "0.8.28",
      optimizer: true,
      optimizerRuns: 200,
      evmVersion: "cancun",
    },
    TestStock: {
      name: "TestStock",
      bytecodeHash: keccak256(artifacts["TestStock"]?.bytecode as Hex),
      compilerVersion: "0.8.28",
      optimizer: true,
      optimizerRuns: 200,
      evmVersion: "cancun",
    },
    KyroxExchange: {
      name: "KyroxExchange",
      bytecodeHash: keccak256(artifacts["KyroxExchange"]?.bytecode as Hex),
      compilerVersion: "0.8.28",
      optimizer: true,
      optimizerRuns: 200,
      evmVersion: "cancun",
    },
  },
  createdAt: "2026-11-21T00:00:00.000Z",
}).manifest;

const evidence: DeploymentEvidence = {
  environment: "base-sepolia",
  chainId: 84_532,
  proposalHash: PROPOSAL_HASH,
  roles: { admin: ADMIN, priceUpdater: UPDATER, pauser: PAUSER, deployer: DEPLOYER },
  contracts: {
    TestUSDC: { address: USDC, transactionHash: `0x${"01".repeat(32)}` },
    "TestStock:tAAPL": { address: STOCK, transactionHash: `0x${"02".repeat(32)}` },
    KyroxExchange: { address: EXCHANGE, transactionHash: `0x${"03".repeat(32)}` },
  },
};

function deployInput(artifact: DeploymentArtifact, args: readonly unknown[]): Hex {
  const constructor = artifact.abi.find((entry) => entry.type === "constructor");
  const inputs = constructor?.type === "constructor" ? constructor.inputs : [];
  return `${artifact.bytecode}${encodeAbiParameters(inputs, args).slice(2)}` as Hex;
}

function deploymentRpc(overrides: Partial<DeploymentVerifierRpc> = {}): DeploymentVerifierRpc {
  const addresses: Record<string, string> = {
    [USDC.toLowerCase()]: "KYROX Test USD",
    [STOCK.toLowerCase()]: "Test Apple",
    [EXCHANGE.toLowerCase()]: "KyroxExchange",
  };
  const symbols: Record<string, string> = {
    [USDC.toLowerCase()]: "tUSDC",
    [STOCK.toLowerCase()]: "tAAPL",
  };
  return {
    getChainId: async () => 84_532,
    getTransactionReceipt: async (txHash) => {
      const entry = Object.entries(evidence.contracts).find(
        ([, contract]) => contract.transactionHash === txHash,
      );
      return entry === undefined
        ? null
        : {
            status: "success",
            contractAddress: entry[1].address,
            blockNumber: 100n,
            blockHash: BLOCK_HASH,
          };
    },
    getBlockNumber: async () => 105n,
    getBlock: async () => ({ hash: BLOCK_HASH, timestamp: 1_795_000_000 }),
    getTransaction: async (txHash) => {
      if (txHash === evidence.contracts["TestUSDC"]?.transactionHash) {
        return {
          input: deployInput(artifacts["TestUSDC"] as DeploymentArtifact, [ADMIN]),
          from: DEPLOYER,
        };
      }
      if (txHash === evidence.contracts["TestStock:tAAPL"]?.transactionHash) {
        return {
          input: deployInput(artifacts["TestStock"] as DeploymentArtifact, [
            "Test Apple",
            "tAAPL",
            18,
            ADMIN,
          ]),
          from: DEPLOYER,
        };
      }
      if (txHash === evidence.contracts["KyroxExchange"]?.transactionHash) {
        return {
          input: deployInput(artifacts["KyroxExchange"] as DeploymentArtifact, [USDC, ADMIN]),
          from: DEPLOYER,
        };
      }
      return null;
    },
    getCode: async (address) => {
      if (address === STOCK) {
        return `0x${"dd".repeat(32)}${"bb".repeat(8)}` as Hex;
      }
      if (address === USDC) return artifacts["TestUSDC"]?.deployedBytecode as Hex;
      return artifacts["KyroxExchange"]?.deployedBytecode as Hex;
    },
    readDecimals: async (address) => (address === USDC ? 6 : 18),
    readName: async (address) => addresses[address.toLowerCase()] ?? "unknown",
    readSymbol: async (address) => symbols[address.toLowerCase()] ?? "unknown",
    hasRole: async () => true,
    readUsdc: async () => USDC,
    readPaused: async () => false,
    readTotalSupply: async () => 0n,
    readAssetSettings: async () => ({
      listed: true,
      stockDecimals: 18,
      maxSourceAgeSeconds: 3_600,
      maxPriceDeviationBps: 500,
      minPriceUsdcPerWholeToken: 1n,
      maxPriceUsdcPerWholeToken: 10n ** 12n,
    }),
    ...overrides,
  };
}

const chainIdentity = {
  chainId: 84_532 as const,
  genesisHash: BASE_SEPOLIA_GENESIS_HASH,
  checkpointBlock: BASE_SEPOLIA_CHECKPOINT_BLOCK,
  checkpointHash: BASE_SEPOLIA_CHECKPOINT_HASH,
  providers: ["a", "b"],
};

const params = {
  evidence,
  proposal,
  artifacts,
  rpc: deploymentRpc(),
  expectedProposalHash: PROPOSAL_HASH,
  chainIdentity,
  minConfirmations: 1,
};

describe("deployment evidence verification", () => {
  it("accepts fully matching mock evidence", async () => {
    const report = await verifyDeployment(params);
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.contracts["TestUSDC"]?.address).toBe(USDC);
  });

  it("rejects the wrong chain", async () => {
    await expect(
      verifyDeployment({ ...params, rpc: deploymentRpc({ getChainId: async () => 8_453 }) }),
    ).rejects.toBeTruthy();
  });

  it("rejects missing bytecode and zero addresses", async () => {
    const noCode = await verifyDeployment({
      ...params,
      rpc: deploymentRpc({ getCode: async () => "0x" }),
    });
    expect(noCode.ok).toBe(false);
    expect(noCode.failures.join(" ")).toContain("no bytecode");

    const zero = await verifyDeployment({
      ...params,
      evidence: {
        ...evidence,
        contracts: {
          ...evidence.contracts,
          TestUSDC: {
            address: "0x0000000000000000000000000000000000000000",
            transactionHash: `0x${"01".repeat(32)}`,
          },
        },
      },
    });
    expect(zero.ok).toBe(false);
  });

  it("rejects runtime bytecode that differs outside immutables", async () => {
    const report = await verifyDeployment({
      ...params,
      rpc: deploymentRpc({ getCode: async () => `0x${"aa".repeat(39)}ef` as Hex }),
    });
    expect(report.ok).toBe(false);
    expect(report.failures.join(" ")).toContain("runtime bytecode");
  });

  it("rejects incorrect constructor evidence", async () => {
    const report = await verifyDeployment({
      ...params,
      rpc: deploymentRpc({
        getTransaction: async (txHash) =>
          txHash === evidence.contracts["TestUSDC"]?.transactionHash
            ? {
                input: deployInput(artifacts["TestUSDC"] as DeploymentArtifact, [OTHER]),
                from: DEPLOYER,
              }
            : null,
      }),
    });
    expect(report.ok).toBe(false);
    expect(report.failures.join(" ")).toContain("constructor");
  });

  it("rejects creation code that differs while runtime stays correct", async () => {
    const report = await verifyDeployment({
      ...params,
      rpc: deploymentRpc({
        getTransaction: async (txHash) =>
          txHash === evidence.contracts["TestUSDC"]?.transactionHash
            ? {
                input:
                  `0x6009${deployInput(artifacts["TestUSDC"] as DeploymentArtifact, [ADMIN]).slice(6)}` as Hex,
                from: DEPLOYER,
              }
            : null,
      }),
    });
    expect(report.ok).toBe(false);
    expect(report.failures.join(" ")).toContain("initcode");
    expect(report.failures.join(" ")).toContain("creation bytecode");
  });

  it("rejects an unauthorized deployer and preminted supply", async () => {
    const wrongDeployer = await verifyDeployment({
      ...params,
      rpc: deploymentRpc({
        getTransaction: async (txHash) =>
          txHash === evidence.contracts["TestUSDC"]?.transactionHash
            ? {
                input: deployInput(artifacts["TestUSDC"] as DeploymentArtifact, [ADMIN]),
                from: OTHER,
              }
            : null,
      }),
    });
    expect(wrongDeployer.ok).toBe(false);
    expect(wrongDeployer.failures.join(" ")).toContain("approved deployer");

    const preminted = await verifyDeployment({
      ...params,
      rpc: deploymentRpc({ readTotalSupply: async () => 1_000_000n }),
    });
    expect(preminted.ok).toBe(false);
    expect(preminted.failures.join(" ")).toContain("initial supply");
  });

  it("rejects insufficient deployment confirmations and a non-canonical block", async () => {
    const shallow = await verifyDeployment({ ...params, minConfirmations: 100 });
    expect(shallow.ok).toBe(false);
    expect(shallow.failures.join(" ")).toContain("confirmations");

    const reorgedBlock = await verifyDeployment({
      ...params,
      rpc: deploymentRpc({
        getBlock: async () => ({ hash: `0x${"dd".repeat(32)}`, timestamp: 1_795_000_000 }),
      }),
    });
    expect(reorgedBlock.ok).toBe(false);
    expect(reorgedBlock.failures.join(" ")).toContain("canonical");
  });

  it("rejects missing roles and wrong token metadata", async () => {
    const report = await verifyDeployment({
      ...params,
      rpc: deploymentRpc({
        hasRole: async (contract, role) => !(contract === USDC && role === "EXCHANGE_ROLE"),
        readDecimals: async (address) => (address === USDC ? 8 : 18),
      }),
    });
    expect(report.ok).toBe(false);
    expect(report.failures.join(" ")).toContain("decimals");
    expect(report.failures.join(" ")).toContain("exchange burn/mint role");
  });

  it("rejects the wrong settlement token and asset configuration", async () => {
    const report = await verifyDeployment({
      ...params,
      rpc: deploymentRpc({
        readUsdc: async () => OTHER,
        readAssetSettings: async () => ({
          listed: false,
          stockDecimals: 18,
          maxSourceAgeSeconds: 60,
          maxPriceDeviationBps: 0,
          minPriceUsdcPerWholeToken: 1n,
          maxPriceUsdcPerWholeToken: 2n,
        }),
      }),
    });
    expect(report.ok).toBe(false);
    expect(report.failures.join(" ")).toContain("settlement token");
    expect(report.failures.join(" ")).toContain("not listed");
    expect(report.failures.join(" ")).toContain("freshness");
    expect(report.failures.join(" ")).toContain("deviation");
  });
});

describe("pending deployment recording and activation", () => {
  async function verified(): Promise<ReturnType<typeof buildPendingDeploymentRecord>> {
    const report = await verifyDeployment(params);
    return buildPendingDeploymentRecord({
      proposal,
      proposalHash: PROPOSAL_HASH,
      evidence,
      verification: report,
      createdAt: "2026-11-21T00:00:00.000Z",
    });
  }

  function io(initial: Record<string, string> = {}) {
    const files = new Map(Object.entries(initial));
    return {
      files,
      io: {
        readFile: (path: string) => files.get(path) ?? "",
        writeFile: (path: string, contents: string) => {
          files.set(path, contents);
        },
        exists: (path: string) => files.has(path),
      },
    };
  }

  it("records a deterministic pending record and produces a valid manifest", async () => {
    const record = await verified();
    expect(record.status).toBe("verified_pending_activation");
    expect(record.contracts["TestUSDC"]?.address).toBe(USDC);
    expect(record.assets["tAAPL"]?.stockToken).toBe(STOCK);

    const manifest = pendingToManifest(record);
    expect(manifest.status).toBe("deployed");
    expect(manifest.environment).toBe("base-sepolia");
    expect(() => parseDeploymentManifest(manifest)).not.toThrow();
  });

  it("rejects incomplete pending records", async () => {
    const record = await verified();
    expect(() => validatePendingRecord({ ...record, status: "prepared" as never })).toThrow(
      ManifestActivationError,
    );
    const missing = { ...record, contracts: { TestUSDC: record.contracts["TestUSDC"]! } };
    expect(() => validatePendingRecord(missing as PendingDeploymentRecord)).toThrow(
      ManifestActivationError,
    );
    expect(() => parseDeploymentManifest({ ...record, contracts: {} })).toThrow();
  });

  it("requires explicit confirmation and protects an existing live manifest", async () => {
    const record = await verified();

    const empty = io();
    expect(() =>
      promotePendingManifest({
        record,
        expectedProposalHash: PROPOSAL_HASH,
        targetPath: "live.json",
        confirmed: false,
        io: empty.io,
        now: new Date("2026-11-21T00:00:00Z"),
      }),
    ).toThrow(ManifestActivationError);

    const result = promotePendingManifest({
      record,
      expectedProposalHash: PROPOSAL_HASH,
      targetPath: "live.json",
      confirmed: true,
      io: empty.io,
      now: new Date("2026-11-21T00:00:00Z"),
    });
    expect(result.written).toBe(true);
    expect(() =>
      parseDeploymentManifest(JSON.parse(empty.files.get("live.json") ?? "")),
    ).not.toThrow();

    const existingLive = JSON.stringify({
      chainId: 84_532,
      environment: "base-sepolia",
      status: "deployed",
      contracts: { TestUSDC: { address: USDC } },
      assets: {},
    });
    const occupied = io({ "live.json": existingLive });
    expect(() =>
      promotePendingManifest({
        record,
        expectedProposalHash: PROPOSAL_HASH,
        targetPath: "live.json",
        confirmed: true,
        io: occupied.io,
        now: new Date("2026-11-21T00:00:00Z"),
      }),
    ).toThrow(ManifestActivationError);

    const replaced = promotePendingManifest({
      record,
      expectedProposalHash: PROPOSAL_HASH,
      targetPath: "live.json",
      confirmed: true,
      overwriteApproved: true,
      io: occupied.io,
      now: new Date("2026-11-21T00:00:00Z"),
    });
    expect(replaced.written).toBe(true);
    expect(replaced.backupPath).toBeDefined();
    expect(occupied.files.get(replaced.backupPath ?? "")).toBe(existingLive);
  });

  it("refuses to promote evidence for a different proposal", async () => {
    const record = await verified();
    const { io: memory } = io();
    expect(() =>
      promotePendingManifest({
        record,
        expectedProposalHash: `0x${"99".repeat(32)}`,
        targetPath: "live.json",
        confirmed: true,
        io: memory,
        now: new Date(),
      }),
    ).toThrow(ManifestActivationError);
  });
});
