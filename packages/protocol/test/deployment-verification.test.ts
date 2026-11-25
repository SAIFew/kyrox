import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256, toHex, type Abi, type Address, type Hex } from "viem";

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
import { parseDeploymentConfirmations } from "../../../scripts/verify-sepolia-deployment.js";

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
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const ZERO32 = `0x${"00".repeat(32)}` as Hex;
const FAUCET_TX = `0x${"04".repeat(32)}` as Hex;
const ROLE_GRANTED_TOPIC = keccak256(toHex("RoleGranted(bytes32,address,address)"));
const ROLE_REVOKED_TOPIC = keccak256(toHex("RoleRevoked(bytes32,address,address)"));
const TRANSFER_TOPIC = keccak256(toHex("Transfer(address,address,uint256)"));

function addressTopic(address: Address): Hex {
  return `0x${"00".repeat(12)}${address.slice(2)}` as Hex;
}

function roleLog(
  address: Address,
  role: Hex,
  account: Address,
  options: {
    revoked?: boolean;
    logIndex?: number;
    blockNumber?: bigint;
  } = {},
) {
  return {
    address,
    topics: [
      options.revoked === true ? ROLE_REVOKED_TOPIC : ROLE_GRANTED_TOPIC,
      role,
      addressTopic(account),
      addressTopic(DEPLOYER),
    ],
    data: "0x" as Hex,
    blockNumber: options.blockNumber ?? 100n,
    logIndex: options.logIndex ?? 0,
    transactionHash: FAUCET_TX,
    blockHash: BLOCK_HASH,
    removed: false,
  };
}

function transferLog(
  address: Address,
  from: Address,
  to: Address,
  value: bigint,
  transactionHash: Hex = FAUCET_TX,
) {
  return {
    address,
    topics: [TRANSFER_TOPIC, addressTopic(from), addressTopic(to)],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    blockNumber: 101n,
    logIndex: 1,
    transactionHash,
    blockHash: BLOCK_HASH,
    removed: false,
  };
}

function expectedRoleLogs(
  address: Address,
  accounts: readonly Address[],
): ReturnType<typeof roleLog>[] {
  return accounts.map((account, index) => roleLog(address, ZERO32, account, { logIndex: index }));
}

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
  const exchangeRole = keccak256(toHex("KYROX_EXCHANGE_ROLE"));
  const updaterRole = keccak256(toHex("KYROX_PRICE_UPDATER_ROLE"));
  const pauserRole = keccak256(toHex("KYROX_PAUSER_ROLE"));
  const logsByAddress: Record<string, ReturnType<typeof roleLog>[]> = {
    [USDC.toLowerCase()]: [
      ...expectedRoleLogs(USDC, [ADMIN]),
      roleLog(USDC, exchangeRole, EXCHANGE, { logIndex: 1 }),
    ],
    [STOCK.toLowerCase()]: [
      ...expectedRoleLogs(STOCK, [ADMIN]),
      roleLog(STOCK, exchangeRole, EXCHANGE, { logIndex: 1 }),
    ],
    [EXCHANGE.toLowerCase()]: [
      ...expectedRoleLogs(EXCHANGE, [ADMIN]),
      roleLog(EXCHANGE, updaterRole, UPDATER, { logIndex: 1 }),
      roleLog(EXCHANGE, pauserRole, PAUSER, { logIndex: 2 }),
    ],
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
    getLogs: async ({ address }) => logsByAddress[address.toLowerCase()] ?? [],
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

function matchingRpcs(overrides: Partial<DeploymentVerifierRpc> = {}) {
  return { rpc: deploymentRpc(overrides), secondaryRpc: deploymentRpc(overrides) };
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
  secondaryRpc: deploymentRpc(),
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
      ...matchingRpcs({ getCode: async () => "0x" }),
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
      ...matchingRpcs({ getCode: async () => `0x${"aa".repeat(39)}ef` as Hex }),
    });
    expect(report.ok).toBe(false);
    expect(report.failures.join(" ")).toContain("runtime bytecode");
  });

  it("rejects incorrect constructor evidence", async () => {
    const report = await verifyDeployment({
      ...params,
      ...matchingRpcs({
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
      ...matchingRpcs({
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

  it("rejects an unauthorized deployer and historically preminted supply", async () => {
    const wrongDeployer = await verifyDeployment({
      ...params,
      ...matchingRpcs({
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

    const base = deploymentRpc();
    const preminted = await verifyDeployment({
      ...params,
      ...matchingRpcs({
        getLogs: async (request) => {
          const logs = await base.getLogs(request);
          return request.address === USDC
            ? [
                ...logs,
                transferLog(
                  USDC,
                  ZERO_ADDRESS,
                  ADMIN,
                  1_000_000n,
                  evidence.contracts["TestUSDC"]!.transactionHash,
                ),
              ]
            : logs;
        },
        readTotalSupply: async (address) => (address === USDC ? 1_000_000n : 0n),
      }),
    });
    expect(preminted.ok).toBe(false);
    expect(preminted.failures.join(" ")).toContain("constructor minted");
  });

  it("accepts non-zero current supply only when historical transfers reconcile", async () => {
    const base = deploymentRpc();
    const report = await verifyDeployment({
      ...params,
      ...matchingRpcs({
        getLogs: async (request) => {
          const logs = await base.getLogs(request);
          return request.address === USDC
            ? [...logs, transferLog(USDC, ZERO_ADDRESS, OTHER, 1_000_000n)]
            : logs;
        },
        readTotalSupply: async (address) => (address === USDC ? 1_000_000n : 0n),
      }),
    });
    expect(report.ok).toBe(true);
    expect(report.checks.join(" ")).toContain("historical supply reconciliation");
  });

  it("rejects insufficient deployment confirmations and a non-canonical block", async () => {
    const shallow = await verifyDeployment({ ...params, minConfirmations: 100 });
    expect(shallow.ok).toBe(false);
    expect(shallow.failures.join(" ")).toContain("confirmations");

    const reorgedBlock = await verifyDeployment({
      ...params,
      ...matchingRpcs({
        getBlock: async () => ({ hash: `0x${"dd".repeat(32)}`, timestamp: 1_795_000_000 }),
      }),
    });
    expect(reorgedBlock.ok).toBe(false);
    expect(reorgedBlock.failures.join(" ")).toContain("canonical");
  });

  it("rejects missing roles and wrong token metadata", async () => {
    const report = await verifyDeployment({
      ...params,
      ...matchingRpcs({
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
      ...matchingRpcs({
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
  it("rejects non-positive, fractional and non-finite confirmation thresholds", async () => {
    for (const minConfirmations of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(verifyDeployment({ ...params, minConfirmations })).rejects.toThrow(
        /positive integer/,
      );
    }
  });

  it("requires independent RPC agreement on receipts, bytecode and mutable state", async () => {
    const receiptMismatch = await verifyDeployment({
      ...params,
      secondaryRpc: deploymentRpc({
        getTransactionReceipt: async (txHash) => {
          const receipt = await deploymentRpc().getTransactionReceipt(txHash);
          return receipt === null ? null : { ...receipt, blockHash: `0x${"ee".repeat(32)}` };
        },
      }),
    });
    expect(receiptMismatch.ok).toBe(false);
    expect(receiptMismatch.failures.join(" ")).toContain(
      "deployment receipt: independent RPCs disagree",
    );

    const codeMismatch = await verifyDeployment({
      ...params,
      secondaryRpc: deploymentRpc({ getCode: async () => "0x1234" }),
    });
    expect(codeMismatch.ok).toBe(false);
    expect(codeMismatch.failures.join(" ")).toContain(
      "runtime bytecode: independent RPCs disagree",
    );

    const stateMismatch = await verifyDeployment({
      ...params,
      secondaryRpc: deploymentRpc({ readPaused: async () => true }),
    });
    expect(stateMismatch.ok).toBe(false);
    expect(stateMismatch.failures.join(" ")).toContain("pause state: independent RPCs disagree");
  });

  it("detects unexpected EXCHANGE_ROLE grants even when later revoked", async () => {
    const base = deploymentRpc();
    const exchangeRole = keccak256(toHex("KYROX_EXCHANGE_ROLE"));
    const report = await verifyDeployment({
      ...params,
      ...matchingRpcs({
        getLogs: async (request) => {
          const logs = await base.getLogs(request);
          return request.address === STOCK
            ? [
                ...logs,
                roleLog(STOCK, exchangeRole, OTHER, { logIndex: 3 }),
                roleLog(STOCK, exchangeRole, OTHER, { logIndex: 4, revoked: true }),
              ]
            : logs;
        },
      }),
    });
    expect(report.ok).toBe(false);
    expect(report.failures.join(" ")).toContain("unexpected");
    expect(report.failures.join(" ")).toContain("EXCHANGE_ROLE");
  });
});

describe("activation confirmation configuration", () => {
  it("accepts only positive safe integer environment values", () => {
    expect(parseDeploymentConfirmations(undefined)).toBe(12);
    expect(parseDeploymentConfirmations("1")).toBe(1);
    expect(parseDeploymentConfirmations(" 12 ")).toBe(12);
    for (const raw of ["", " ", "0", "-1", "1.5", "NaN", "Infinity", "12x", "9007199254740992"]) {
      expect(() => parseDeploymentConfirmations(raw)).toThrow(/positive safe integer/);
    }
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
    expect(record.integrityHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
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

  it("rejects mutated pending evidence before promotion", async () => {
    const record = await verified();
    const mutated = {
      ...record,
      contracts: {
        ...record.contracts,
        TestUSDC: {
          ...record.contracts["TestUSDC"]!,
          runtimeBytecodeHash: `0x${"99".repeat(32)}` as Hex,
        },
      },
    };
    expect(() => validatePendingRecord(mutated)).toThrow(/integrity hash/);
    const memory = io();
    expect(() =>
      promotePendingManifest({
        record: mutated,
        expectedProposalHash: PROPOSAL_HASH,
        targetPath: "live.json",
        confirmed: true,
        io: memory.io,
        now: new Date(),
      }),
    ).toThrow(/integrity hash/);
    expect(memory.files.size).toBe(0);
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
