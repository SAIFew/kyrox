import {
  decodeAbiParameters,
  decodeEventLog,
  encodeAbiParameters,
  keccak256,
  toHex,
  type Abi,
  type Hex,
} from "viem";

import type { Address } from "@kyrox/core";
import type { ProposedDeploymentManifest } from "./deployment-plan.js";
import { assertChainIdentityEvidence, type ChainIdentityEvidence } from "./chain-identity.js";

export interface DeploymentEvidenceContract {
  readonly address: Address;
  readonly transactionHash: Hex;
}

export interface DeploymentEvidence {
  readonly environment: "base-sepolia";
  readonly chainId: 84_532;
  readonly proposalHash: Hex;
  readonly contracts: Readonly<Record<string, DeploymentEvidenceContract>>;
  readonly roles: DeploymentRolesEvidence;
}

export interface DeploymentRolesEvidence {
  readonly admin: Address;
  readonly priceUpdater: Address;
  readonly pauser: Address;
  readonly deployer: Address;
}

export interface DeploymentArtifact {
  readonly abi: Abi;
  readonly bytecode: Hex;
  readonly deployedBytecode: Hex;
  /** Solidity immutable references keyed by AST id, with byte offsets/lengths. */
  readonly immutableReferences: Readonly<
    Record<string, readonly { start: number; length: number }[]>
  >;
}

export interface AssetSettingsSnapshot {
  readonly listed: boolean;
  readonly stockDecimals: number;
  readonly maxSourceAgeSeconds: number;
  readonly maxPriceDeviationBps: number;
  readonly minPriceUsdcPerWholeToken: bigint;
  readonly maxPriceUsdcPerWholeToken: bigint;
}

export interface DeploymentReceipt {
  readonly status: "success" | "reverted";
  readonly contractAddress: Address | null;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
}

/** Relevant historical event returned by an independent RPC. */
export interface DeploymentLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly blockNumber: bigint;
  readonly logIndex: number;
  readonly transactionHash: Hex;
  readonly blockHash: Hex;
  readonly removed: boolean;
}

/** Read-only chain surface used by deployment verification. */
export interface DeploymentVerifierRpc {
  getChainId(): Promise<number>;
  getTransactionReceipt(txHash: Hex): Promise<DeploymentReceipt | null>;
  getTransaction(txHash: Hex): Promise<{ input: Hex; from: Address } | null>;
  getBlockNumber(): Promise<bigint>;
  getBlock(blockNumber: bigint): Promise<{ hash: Hex; timestamp: number }>;
  getCode(address: Address, blockNumber?: bigint): Promise<Hex>;
  getLogs(params: {
    address: Address;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<readonly DeploymentLog[]>;
  readDecimals(address: Address, blockNumber?: bigint): Promise<number>;
  readName(address: Address, blockNumber?: bigint): Promise<string>;
  readSymbol(address: Address, blockNumber?: bigint): Promise<string>;
  hasRole(
    contract: Address,
    role: "DEFAULT_ADMIN_ROLE" | "EXCHANGE_ROLE" | "PRICE_UPDATER_ROLE" | "PAUSER_ROLE",
    account: Address,
    blockNumber?: bigint,
  ): Promise<boolean>;
  readUsdc(exchange: Address, blockNumber?: bigint): Promise<Address>;
  readPaused(exchange: Address, blockNumber?: bigint): Promise<boolean>;
  readTotalSupply(token: Address, blockNumber?: bigint): Promise<bigint>;
  readAssetSettings(
    exchange: Address,
    token: Address,
    blockNumber?: bigint,
  ): Promise<AssetSettingsSnapshot>;
}

export interface DeploymentVerificationReport {
  readonly ok: boolean;
  readonly checks: readonly string[];
  readonly failures: readonly string[];
  readonly contracts: Readonly<
    Record<
      string,
      { address: Address; runtimeBytecodeHash: Hex; blockNumber: string; blockHash: Hex }
    >
  >;
}

export class DeploymentEvidenceError extends Error {
  override readonly name = "DeploymentEvidenceError";
}

const ZERO32 = `0x${"00".repeat(32)}` as Hex;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ROLE_GRANTED_TOPIC = keccak256(toHex("RoleGranted(bytes32,address,address)"));
const ROLE_REVOKED_TOPIC = keccak256(toHex("RoleRevoked(bytes32,address,address)"));
const TRANSFER_TOPIC = keccak256(toHex("Transfer(address,address,uint256)"));
const ROLE_HASHES = {
  DEFAULT_ADMIN_ROLE: ZERO32,
  EXCHANGE_ROLE: keccak256(toHex("KYROX_EXCHANGE_ROLE")),
  PRICE_UPDATER_ROLE: keccak256(toHex("KYROX_PRICE_UPDATER_ROLE")),
  PAUSER_ROLE: keccak256(toHex("KYROX_PAUSER_ROLE")),
} as const;
const ROLE_EVENT_ABI = [
  {
    type: "event",
    name: "RoleGranted",
    inputs: [
      { name: "role", type: "bytes32", indexed: true },
      { name: "account", type: "address", indexed: true },
      { name: "sender", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "RoleRevoked",
    inputs: [
      { name: "role", type: "bytes32", indexed: true },
      { name: "account", type: "address", indexed: true },
      { name: "sender", type: "address", indexed: true },
    ],
  },
] as const;

type RoleName = "DEFAULT_ADMIN_ROLE" | "EXCHANGE_ROLE" | "PRICE_UPDATER_ROLE" | "PAUSER_ROLE";

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function sameHex(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function maskImmutables(
  code: Hex,
  references: Readonly<Record<string, readonly { start: number; length: number }[]>>,
): Hex {
  const bytes = code.slice(2).split("");
  for (const refs of Object.values(references)) {
    for (const ref of refs) {
      for (let index = 0; index < ref.length; index += 1) {
        const byteIndex = ref.start + index;
        const charIndex = byteIndex * 2;
        if (charIndex + 1 < bytes.length) {
          bytes[charIndex] = "0";
          bytes[charIndex + 1] = "0";
        }
      }
    }
  }
  return `0x${bytes.join("")}` as Hex;
}

export function runtimeBytecodeMatches(
  actual: Hex,
  expected: Hex,
  immutableReferences: DeploymentArtifact["immutableReferences"],
): boolean {
  if (actual.length !== expected.length) return false;
  return (
    maskImmutables(actual, immutableReferences) === maskImmutables(expected, immutableReferences)
  );
}

function expectedConstructorArgs(
  name: string,
  proposal: ProposedDeploymentManifest,
  evidence: DeploymentEvidence,
): readonly unknown[] {
  if (name === "TestUSDC") return [evidence.roles.admin];
  if (name === "KyroxExchange") {
    const usdc = evidence.contracts["TestUSDC"]?.address;
    if (usdc === undefined) {
      throw new DeploymentEvidenceError(
        "TestUSDC evidence is required for the exchange constructor.",
      );
    }
    return [usdc, evidence.roles.admin];
  }
  if (name.startsWith("TestStock:")) {
    const symbol = name.slice("TestStock:".length);
    const asset = proposal.assets.find((entry) => entry.symbol === symbol);
    if (asset === undefined) {
      throw new DeploymentEvidenceError(`Proposal has no asset ${symbol}.`);
    }
    return [asset.name, asset.symbol, asset.decimals, evidence.roles.admin];
  }
  throw new DeploymentEvidenceError(`Unknown contract ${name}.`);
}

function decodeConstructorArgs(artifact: DeploymentArtifact, input: Hex): readonly unknown[] {
  const constructor = artifact.abi.find((entry) => entry.type === "constructor");
  const inputs =
    constructor !== undefined && constructor.type === "constructor" ? constructor.inputs : [];
  if (inputs.length === 0) return [];
  const prefix = 2 + artifact.bytecode.length - 2;
  return decodeAbiParameters(inputs, `0x${input.slice(prefix)}` as Hex);
}

function normalizeLog(log: DeploymentLog): string {
  return JSON.stringify({
    address: log.address.toLowerCase(),
    topics: log.topics.map((topic) => topic.toLowerCase()),
    data: log.data.toLowerCase(),
    blockNumber: log.blockNumber.toString(),
    logIndex: log.logIndex,
    transactionHash: log.transactionHash.toLowerCase(),
    blockHash: log.blockHash.toLowerCase(),
    removed: log.removed,
  });
}

function topicAddress(topic: Hex | undefined): Address | null {
  if (topic === undefined || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return null;
  return `0x${topic.slice(-40)}` as Address;
}

/** Verify externally supplied deployment evidence. Strictly read-only. */
export async function verifyDeployment(params: {
  readonly evidence: DeploymentEvidence;
  readonly proposal: ProposedDeploymentManifest;
  readonly artifacts: Readonly<Record<string, DeploymentArtifact>>;
  readonly rpc: DeploymentVerifierRpc;
  /** A genuinely independent RPC; critical observations must agree. */
  readonly secondaryRpc: DeploymentVerifierRpc;
  readonly expectedProposalHash: Hex;
  readonly chainIdentity: ChainIdentityEvidence;
  /** Deployment transactions must reach this depth before activation. */
  readonly minConfirmations?: number;
}): Promise<DeploymentVerificationReport> {
  const checks: string[] = [];
  const failures: string[] = [];
  const contractResults: Record<
    string,
    { address: Address; runtimeBytecodeHash: Hex; blockNumber: string; blockHash: Hex }
  > = {};
  const inclusions = new Map<string, { address: Address; blockNumber: bigint; txHash: Hex }>();

  if (params.evidence.environment !== "base-sepolia" || params.evidence.chainId !== 84_532) {
    throw new DeploymentEvidenceError("Evidence must target Base Sepolia (84532).");
  }
  assertChainIdentityEvidence(params.chainIdentity);
  const minConfirmations = params.minConfirmations ?? 12;
  if (!Number.isSafeInteger(minConfirmations) || minConfirmations < 1) {
    throw new DeploymentEvidenceError(
      "Deployment confirmation threshold must be a positive integer.",
    );
  }
  if (!sameHex(params.evidence.proposalHash, params.expectedProposalHash)) {
    failures.push("evidence proposal hash does not match the reviewed proposal");
  } else {
    checks.push("evidence proposal hash matches");
  }
  if (
    !sameAddress(params.evidence.roles.admin, params.proposal.roles.admin) ||
    !sameAddress(params.evidence.roles.priceUpdater, params.proposal.roles.priceUpdater) ||
    !sameAddress(params.evidence.roles.pauser, params.proposal.roles.pauser) ||
    !sameAddress(params.evidence.roles.deployer, params.proposal.roles.deployer)
  ) {
    failures.push("evidence role addresses do not match the proposal");
  } else {
    checks.push("role addresses match the proposal");
  }

  const [primaryChainId, secondaryChainId] = await Promise.all([
    params.rpc.getChainId(),
    params.secondaryRpc.getChainId(),
  ]);
  if (primaryChainId !== 84_532 || secondaryChainId !== 84_532) {
    throw new DeploymentEvidenceError(
      `RPC chains ${primaryChainId}/${secondaryChainId} are not Base Sepolia (84532).`,
    );
  }
  checks.push("both RPCs report chain 84532");

  const [primaryHead, secondaryHead] = await Promise.all([
    params.rpc.getBlockNumber(),
    params.secondaryRpc.getBlockNumber(),
  ]);
  // Pin mutable state reads to a common canonical block so ordinary chain
  // progress between the two requests cannot look like provider disagreement.
  const stateBlock = primaryHead < secondaryHead ? primaryHead : secondaryHead;

  async function agree<T>(
    label: string,
    read: (rpc: DeploymentVerifierRpc) => Promise<T>,
    equal: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b),
  ): Promise<T | undefined> {
    try {
      const [primary, secondary] = await Promise.all([read(params.rpc), read(params.secondaryRpc)]);
      if (!equal(primary, secondary)) {
        failures.push(`${label}: independent RPCs disagree`);
        return undefined;
      }
      checks.push(`${label}: independent RPCs agree`);
      return primary;
    } catch (error) {
      failures.push(
        `${label}: RPC read failed (${error instanceof Error ? error.message : String(error)})`,
      );
      return undefined;
    }
  }

  const proposedNames = new Set(params.proposal.contracts.map((step) => step.name));
  for (const name of Object.keys(params.evidence.contracts)) {
    if (!proposedNames.has(name))
      failures.push(`${name}: evidence is not in the reviewed proposal`);
  }
  const seenAddresses = new Set<string>();
  const seenTransactions = new Set<string>();

  for (const step of params.proposal.contracts) {
    const name = step.name;
    const evidence = params.evidence.contracts[name];
    if (evidence === undefined) {
      failures.push(`${name}: no deployment evidence supplied`);
      continue;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(evidence.address) || /^0x0{40}$/i.test(evidence.address)) {
      failures.push(`${name}: zero or malformed address is not a deployment`);
      continue;
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(evidence.transactionHash)) {
      failures.push(`${name}: malformed deployment transaction hash`);
      continue;
    }
    const normalizedAddress = evidence.address.toLowerCase();
    const normalizedTransaction = evidence.transactionHash.toLowerCase();
    if (seenAddresses.has(normalizedAddress))
      failures.push(`${name}: duplicate deployment address`);
    if (seenTransactions.has(normalizedTransaction)) {
      failures.push(`${name}: duplicate deployment transaction`);
    }
    seenAddresses.add(normalizedAddress);
    seenTransactions.add(normalizedTransaction);

    const artifact = params.artifacts[name.startsWith("TestStock:") ? "TestStock" : name];
    if (artifact === undefined) {
      failures.push(`${name}: compiled artifact is missing`);
      continue;
    }

    const receipt = await agree(
      `${name}: deployment receipt`,
      (rpc) => rpc.getTransactionReceipt(evidence.transactionHash),
      (a, b) =>
        a !== null &&
        b !== null &&
        a.status === b.status &&
        sameAddress(a.contractAddress ?? ZERO_ADDRESS, b.contractAddress ?? ZERO_ADDRESS) &&
        a.blockNumber === b.blockNumber &&
        sameHex(a.blockHash, b.blockHash),
    );
    if (receipt === null || receipt === undefined) {
      failures.push(`${name}: deployment transaction receipt is missing or disagreed`);
      continue;
    }
    if (receipt.status !== "success") failures.push(`${name}: deployment transaction reverted`);
    if (!sameAddress(receipt.contractAddress ?? ZERO_ADDRESS, evidence.address)) {
      failures.push(`${name}: receipt contract address does not match the supplied address`);
    } else {
      checks.push(`${name}: receipt matches the supplied address`);
    }
    inclusions.set(name, {
      address: evidence.address,
      blockNumber: receipt.blockNumber,
      txHash: evidence.transactionHash,
    });

    const primaryConfirmations = Number(primaryHead - receipt.blockNumber) + 1;
    const secondaryConfirmations = Number(secondaryHead - receipt.blockNumber) + 1;
    if (primaryConfirmations < minConfirmations || secondaryConfirmations < minConfirmations) {
      failures.push(
        `${name}: confirmations ${primaryConfirmations}/${secondaryConfirmations}, both must reach ${minConfirmations}`,
      );
    }
    if (receipt.blockNumber > stateBlock) {
      failures.push(`${name}: deployment block is ahead of the common verification head`);
    }

    const canonical = await agree(
      `${name}: deployment block`,
      (rpc) => rpc.getBlock(receipt.blockNumber),
      (a, b) => a.timestamp === b.timestamp && sameHex(a.hash, b.hash),
    );
    if (canonical === undefined) {
      failures.push(`${name}: deployment block could not be agreed independently`);
    } else if (!sameHex(canonical.hash, receipt.blockHash)) {
      failures.push(`${name}: deployment receipt block is no longer canonical`);
    } else if (
      primaryConfirmations >= minConfirmations &&
      secondaryConfirmations >= minConfirmations
    ) {
      checks.push(
        `${name}: deployment block is canonical with ${primaryConfirmations}/${secondaryConfirmations} confirmations`,
      );
    }

    const code = await agree(
      `${name}: runtime bytecode`,
      (rpc) => rpc.getCode(evidence.address, stateBlock),
      (a, b) => sameHex(a, b),
    );
    if (code === undefined) {
      failures.push(`${name}: runtime bytecode could not be agreed independently`);
      continue;
    }
    if (code === "0x" || code.length <= 2) {
      failures.push(`${name}: no bytecode at the supplied address`);
      continue;
    }
    contractResults[name] = {
      address: evidence.address,
      runtimeBytecodeHash: keccak256(code),
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
    };
    if (!runtimeBytecodeMatches(code, artifact.deployedBytecode, artifact.immutableReferences)) {
      failures.push(`${name}: runtime bytecode does not match the compiled artifact`);
    } else {
      checks.push(`${name}: runtime bytecode matches (immutables masked)`);
    }

    const transaction = await agree(
      `${name}: deployment transaction`,
      (rpc) => rpc.getTransaction(evidence.transactionHash),
      (a, b) =>
        a !== null && b !== null && sameAddress(a.from, b.from) && sameHex(a.input, b.input),
    );
    if (transaction === null || transaction === undefined) {
      failures.push(`${name}: deployment transaction body is unavailable or disagreed`);
    } else {
      if (!sameAddress(transaction.from, params.evidence.roles.deployer)) {
        failures.push(`${name}: deployment sender is not the approved deployer`);
      } else {
        checks.push(`${name}: deployed by the approved deployer`);
      }
      try {
        const decoded = decodeConstructorArgs(artifact, transaction.input);
        const expected = expectedConstructorArgs(name, params.proposal, params.evidence);
        const matches =
          decoded.length === expected.length &&
          decoded.every((value, index) => {
            const want = expected[index];
            if (typeof value === "string" && typeof want === "string" && want.startsWith("0x")) {
              return sameAddress(value, want);
            }
            return value === want;
          });
        if (!matches) {
          failures.push(`${name}: constructor arguments do not match the proposal`);
        } else {
          checks.push(`${name}: constructor arguments match`);
        }

        const constructor = artifact.abi.find((entry) => entry.type === "constructor");
        const inputs = constructor?.type === "constructor" ? constructor.inputs : [];
        const expectedInitcode =
          `${artifact.bytecode}${encodeAbiParameters(inputs, expected).slice(2)}` as Hex;
        if (!sameHex(transaction.input, expectedInitcode)) {
          failures.push(
            `${name}: initcode does not match compiled bytecode plus approved arguments`,
          );
        } else {
          checks.push(`${name}: initcode matches exactly`);
        }
        const creationInTransaction = transaction.input.slice(
          0,
          2 + artifact.bytecode.length - 2,
        ) as Hex;
        if (!sameHex(keccak256(creationInTransaction), step.bytecodeHash)) {
          failures.push(`${name}: creation bytecode does not match the proposal hash`);
        }
        if (!sameHex(keccak256(artifact.bytecode), step.bytecodeHash)) {
          failures.push(`${name}: compiled creation bytecode does not match the proposal hash`);
        }
      } catch {
        failures.push(`${name}: constructor arguments could not be decoded`);
      }
    }
  }

  const usdcEvidence = params.evidence.contracts["TestUSDC"];
  const exchangeEvidence = params.evidence.contracts["KyroxExchange"];

  if (usdcEvidence !== undefined) {
    const before = failures.length;
    const decimals = await agree("TestUSDC: decimals", (rpc) =>
      rpc.readDecimals(usdcEvidence.address, stateBlock),
    );
    const name = await agree("TestUSDC: name", (rpc) =>
      rpc.readName(usdcEvidence.address, stateBlock),
    );
    const symbol = await agree("TestUSDC: symbol", (rpc) =>
      rpc.readSymbol(usdcEvidence.address, stateBlock),
    );
    if (decimals !== 6) failures.push("TestUSDC: decimals are not 6");
    if (name !== "KYROX Test USD") failures.push("TestUSDC: unexpected name");
    if (symbol !== "tUSDC") failures.push("TestUSDC: unexpected symbol");
    if (
      !(await agree("TestUSDC: admin role", (rpc) =>
        rpc.hasRole(
          usdcEvidence.address,
          "DEFAULT_ADMIN_ROLE",
          params.evidence.roles.admin,
          stateBlock,
        ),
      ))
    ) {
      failures.push("TestUSDC: admin role missing");
    }
    if (failures.length === before) checks.push("TestUSDC: metadata and admin role verified");
  }

  for (const asset of params.proposal.assets) {
    const key = `TestStock:${asset.symbol}`;
    const evidence = params.evidence.contracts[key];
    if (evidence === undefined) continue;
    const before = failures.length;
    const decimals = await agree(`${key}: decimals`, (rpc) =>
      rpc.readDecimals(evidence.address, stateBlock),
    );
    const name = await agree(`${key}: name`, (rpc) => rpc.readName(evidence.address, stateBlock));
    const symbol = await agree(`${key}: symbol`, (rpc) =>
      rpc.readSymbol(evidence.address, stateBlock),
    );
    if (decimals !== asset.decimals) failures.push(`${key}: decimals mismatch`);
    if (name !== asset.name) failures.push(`${key}: name mismatch`);
    if (symbol !== asset.symbol) failures.push(`${key}: symbol mismatch`);
    if (
      !(await agree(`${key}: admin role`, (rpc) =>
        rpc.hasRole(
          evidence.address,
          "DEFAULT_ADMIN_ROLE",
          params.evidence.roles.admin,
          stateBlock,
        ),
      ))
    ) {
      failures.push(`${key}: admin role missing`);
    }
    if (exchangeEvidence !== undefined) {
      if (
        !(await agree(`${key}: exchange role`, (rpc) =>
          rpc.hasRole(evidence.address, "EXCHANGE_ROLE", exchangeEvidence.address, stateBlock),
        ))
      ) {
        failures.push(`${key}: exchange mint/burn role missing`);
      }
    }
    if (failures.length === before) checks.push(`${key}: metadata and token linkage verified`);
  }

  if (exchangeEvidence !== undefined && usdcEvidence !== undefined) {
    const exchange = exchangeEvidence.address;
    const before = failures.length;
    const usdc = await agree("KyroxExchange: settlement token", (rpc) =>
      rpc.readUsdc(exchange, stateBlock),
    );
    if (usdc === undefined || !sameAddress(usdc, usdcEvidence.address)) {
      failures.push("KyroxExchange: settlement token mismatch");
    }
    for (const role of ["DEFAULT_ADMIN_ROLE", "PRICE_UPDATER_ROLE", "PAUSER_ROLE"] as const) {
      const account =
        role === "DEFAULT_ADMIN_ROLE"
          ? params.evidence.roles.admin
          : role === "PRICE_UPDATER_ROLE"
            ? params.evidence.roles.priceUpdater
            : params.evidence.roles.pauser;
      if (
        !(await agree(`KyroxExchange: ${role}`, (rpc) =>
          rpc.hasRole(exchange, role, account, stateBlock),
        ))
      ) {
        failures.push(`KyroxExchange: ${role} missing`);
      }
    }
    const paused = await agree("KyroxExchange: pause state", (rpc) =>
      rpc.readPaused(exchange, stateBlock),
    );
    if (paused !== false) failures.push("KyroxExchange: exchange is paused after deployment");

    for (const asset of params.proposal.assets) {
      const token = params.evidence.contracts[`TestStock:${asset.symbol}`]?.address;
      if (token === undefined) continue;
      const settings = await agree(
        `${asset.symbol}: asset settings`,
        (rpc) => rpc.readAssetSettings(exchange, token, stateBlock),
        (a, b) =>
          a.listed === b.listed &&
          a.stockDecimals === b.stockDecimals &&
          a.maxSourceAgeSeconds === b.maxSourceAgeSeconds &&
          a.maxPriceDeviationBps === b.maxPriceDeviationBps &&
          a.minPriceUsdcPerWholeToken === b.minPriceUsdcPerWholeToken &&
          a.maxPriceUsdcPerWholeToken === b.maxPriceUsdcPerWholeToken,
      );
      if (settings === undefined) continue;
      if (!settings.listed) failures.push(`${asset.symbol}: not listed on the exchange`);
      if (settings.stockDecimals !== asset.decimals) {
        failures.push(`${asset.symbol}: listed decimals mismatch`);
      }
      if (settings.maxSourceAgeSeconds !== asset.freshness.maxSourceAgeSeconds) {
        failures.push(`${asset.symbol}: freshness bound mismatch`);
      }
      if (settings.maxPriceDeviationBps !== asset.priceBounds.maxPriceDeviationBps) {
        failures.push(`${asset.symbol}: deviation bound mismatch`);
      }
      if (
        settings.minPriceUsdcPerWholeToken.toString() !==
          asset.priceBounds.minPriceUsdcPerWholeToken ||
        settings.maxPriceUsdcPerWholeToken.toString() !==
          asset.priceBounds.maxPriceUsdcPerWholeToken
      ) {
        failures.push(`${asset.symbol}: price bounds mismatch`);
      }
    }
    if (failures.length === before) {
      checks.push("KyroxExchange: roles, pause state, settlement token and assets verified");
    }
  }

  if (exchangeEvidence !== undefined && usdcEvidence !== undefined) {
    if (
      !(await agree("TestUSDC: exchange role", (rpc) =>
        rpc.hasRole(usdcEvidence.address, "EXCHANGE_ROLE", exchangeEvidence.address, stateBlock),
      ))
    ) {
      failures.push("TestUSDC: exchange burn/mint role missing");
    } else {
      checks.push("TestUSDC: exchange role verified");
    }
  }

  async function verifyRoleHistory(
    name: string,
    address: Address,
    expected: Readonly<Partial<Record<RoleName, readonly Address[]>>>,
  ): Promise<void> {
    const inclusion = inclusions.get(name);
    if (inclusion === undefined) return;
    const before = failures.length;
    const logs = await agree(
      `${name}: role event history`,
      (rpc) => rpc.getLogs({ address, fromBlock: inclusion.blockNumber, toBlock: stateBlock }),
      (a, b) =>
        JSON.stringify(a.map(normalizeLog).sort()) === JSON.stringify(b.map(normalizeLog).sort()),
    );
    if (logs === undefined) return;
    const holders = new Map<string, Set<string>>();
    for (const role of Object.keys(expected)) {
      holders.set(ROLE_HASHES[role as RoleName].toLowerCase(), new Set());
    }
    for (const log of logs) {
      if (log.removed || !sameAddress(log.address, address)) {
        failures.push(`${name}: role history contains a removed or misaddressed event`);
        continue;
      }
      const topic = log.topics[0]?.toLowerCase();
      if (
        topic !== ROLE_GRANTED_TOPIC.toLowerCase() &&
        topic !== ROLE_REVOKED_TOPIC.toLowerCase()
      ) {
        continue;
      }
      try {
        const signature = log.topics[0];
        if (signature === undefined) throw new Error("Role event has no signature.");
        const decoded = decodeEventLog({
          abi: ROLE_EVENT_ABI,
          data: log.data,
          topics: [signature, ...log.topics.slice(1)],
        });
        const args = decoded.args as { role: Hex; account: Address };
        const role = args.role.toLowerCase();
        const account = args.account.toLowerCase();
        const roleLabel =
          Object.entries(ROLE_HASHES).find(([, hash]) => hash.toLowerCase() === role)?.[0] ??
          args.role;
        const allowed = holders.get(role);
        if (allowed === undefined) {
          failures.push(`${name}: unexpected privileged role event for ${roleLabel}`);
          continue;
        }
        if (decoded.eventName === "RoleGranted") {
          const expectedAccounts = expected[roleLabel as RoleName] ?? [];
          if (
            !expectedAccounts.some((expectedAccount) => sameAddress(expectedAccount, args.account))
          ) {
            failures.push(`${name}: unexpected ${roleLabel} granted to ${args.account}`);
          }
          allowed.add(account);
        } else {
          allowed.delete(account);
        }
      } catch {
        failures.push(`${name}: malformed role event`);
      }
    }
    for (const [role, expectedAccounts] of Object.entries(expected)) {
      const actual = [...(holders.get(ROLE_HASHES[role as RoleName].toLowerCase()) ?? [])].sort();
      const wanted = expectedAccounts.map((account) => account.toLowerCase()).sort();
      if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
        failures.push(`${name}: ${role} event history does not prove exclusive holders`);
      }
    }
    if (failures.length === before) checks.push(`${name}: privileged role history is exclusive`);
  }

  if (usdcEvidence !== undefined && exchangeEvidence !== undefined) {
    await verifyRoleHistory("TestUSDC", usdcEvidence.address, {
      DEFAULT_ADMIN_ROLE: [params.evidence.roles.admin],
      EXCHANGE_ROLE: [exchangeEvidence.address],
    });
  }
  for (const asset of params.proposal.assets) {
    const key = `TestStock:${asset.symbol}`;
    const evidence = params.evidence.contracts[key];
    if (evidence === undefined || exchangeEvidence === undefined) continue;
    await verifyRoleHistory(key, evidence.address, {
      DEFAULT_ADMIN_ROLE: [params.evidence.roles.admin],
      EXCHANGE_ROLE: [exchangeEvidence.address],
    });
  }
  if (exchangeEvidence !== undefined) {
    await verifyRoleHistory("KyroxExchange", exchangeEvidence.address, {
      DEFAULT_ADMIN_ROLE: [params.evidence.roles.admin],
      PRICE_UPDATER_ROLE: [params.evidence.roles.priceUpdater],
      PAUSER_ROLE: [params.evidence.roles.pauser],
    });
  }

  // Current supply is not constructor evidence: faucets and trading legitimately
  // change it. Reconstruct supply from historical Transfer events and separately
  // inspect the creation transaction for constructor mint/burn activity.
  for (const name of [
    "TestUSDC",
    ...params.proposal.assets.map((asset) => `TestStock:${asset.symbol}`),
  ]) {
    const evidence = params.evidence.contracts[name];
    const inclusion = inclusions.get(name);
    if (evidence === undefined || inclusion === undefined) continue;
    const before = failures.length;
    const logs = await agree(
      `${name}: transfer event history`,
      (rpc) =>
        rpc.getLogs({
          address: evidence.address,
          fromBlock: inclusion.blockNumber,
          toBlock: stateBlock,
        }),
      (a, b) =>
        JSON.stringify(a.map(normalizeLog).sort()) === JSON.stringify(b.map(normalizeLog).sort()),
    );
    if (logs === undefined) continue;
    let historicalSupply = 0n;
    let constructorSupply = 0n;
    for (const log of logs) {
      if (log.removed || !sameAddress(log.address, evidence.address)) {
        failures.push(`${name}: transfer history contains a removed or misaddressed event`);
        continue;
      }
      if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC.toLowerCase()) continue;
      const from = topicAddress(log.topics[1]);
      const to = topicAddress(log.topics[2]);
      if (from === null || to === null) {
        failures.push(`${name}: malformed Transfer event`);
        continue;
      }
      let value: bigint;
      try {
        [value] = decodeAbiParameters([{ type: "uint256" }], log.data);
      } catch {
        failures.push(`${name}: malformed Transfer amount`);
        continue;
      }
      if (sameAddress(from, ZERO_ADDRESS)) historicalSupply += value;
      if (sameAddress(to, ZERO_ADDRESS)) historicalSupply -= value;
      if (sameHex(log.transactionHash, inclusion.txHash)) {
        if (sameAddress(from, ZERO_ADDRESS)) constructorSupply += value;
        if (sameAddress(to, ZERO_ADDRESS)) constructorSupply -= value;
      }
    }
    if (constructorSupply !== 0n) {
      failures.push(`${name}: constructor minted an unexpected initial supply`);
    }
    const currentSupply = await agree(
      `${name}: total supply`,
      (rpc) => rpc.readTotalSupply(evidence.address, stateBlock),
      (a, b) => a === b,
    );
    if (currentSupply === undefined || currentSupply !== historicalSupply) {
      failures.push(`${name}: current supply does not reconcile with historical Transfer events`);
    }
    if (failures.length === before) {
      checks.push(`${name}: zero constructor supply and historical supply reconciliation verified`);
    }
  }

  return {
    ok: failures.length === 0,
    checks,
    failures,
    contracts: contractResults,
  };
}

export { ZERO32, sameAddress, decodeConstructorArgs, expectedConstructorArgs, maskImmutables };
