import { decodeAbiParameters, encodeAbiParameters, keccak256, type Abi, type Hex } from "viem";

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

/** Read-only chain surface used by deployment verification. */
export interface DeploymentVerifierRpc {
  getChainId(): Promise<number>;
  getTransactionReceipt(txHash: Hex): Promise<DeploymentReceipt | null>;
  getTransaction(txHash: Hex): Promise<{ input: Hex; from: Address } | null>;
  getBlockNumber(): Promise<bigint>;
  getBlock(blockNumber: bigint): Promise<{ hash: Hex; timestamp: number }>;
  getCode(address: Address): Promise<Hex>;
  readDecimals(address: Address): Promise<number>;
  readName(address: Address): Promise<string>;
  readSymbol(address: Address): Promise<string>;
  hasRole(
    contract: Address,
    role: "DEFAULT_ADMIN_ROLE" | "EXCHANGE_ROLE" | "PRICE_UPDATER_ROLE" | "PAUSER_ROLE",
    account: Address,
  ): Promise<boolean>;
  readUsdc(exchange: Address): Promise<Address>;
  readPaused(exchange: Address): Promise<boolean>;
  readTotalSupply(token: Address): Promise<bigint>;
  readAssetSettings(exchange: Address, token: Address): Promise<AssetSettingsSnapshot>;
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

function sameAddress(a: string, b: string): boolean {
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

/** Verify externally supplied deployment evidence. Strictly read-only. */
export async function verifyDeployment(params: {
  readonly evidence: DeploymentEvidence;
  readonly proposal: ProposedDeploymentManifest;
  readonly artifacts: Readonly<Record<string, DeploymentArtifact>>;
  readonly rpc: DeploymentVerifierRpc;
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

  if (params.evidence.environment !== "base-sepolia" || params.evidence.chainId !== 84_532) {
    throw new DeploymentEvidenceError("Evidence must target Base Sepolia (84532).");
  }
  assertChainIdentityEvidence(params.chainIdentity);
  const minConfirmations = params.minConfirmations ?? 12;
  if (!Number.isInteger(minConfirmations) || minConfirmations < 1) {
    throw new DeploymentEvidenceError("Deployment confirmation threshold must be positive.");
  }
  if (params.evidence.proposalHash !== params.expectedProposalHash) {
    failures.push("evidence proposal hash does not match the reviewed proposal");
  } else {
    checks.push("evidence proposal hash matches");
  }
  if (
    params.evidence.roles.admin.toLowerCase() !== params.proposal.roles.admin.toLowerCase() ||
    params.evidence.roles.priceUpdater.toLowerCase() !==
      params.proposal.roles.priceUpdater.toLowerCase() ||
    params.evidence.roles.pauser.toLowerCase() !== params.proposal.roles.pauser.toLowerCase() ||
    params.evidence.roles.deployer.toLowerCase() !== params.proposal.roles.deployer.toLowerCase()
  ) {
    failures.push("evidence role addresses do not match the proposal");
  } else {
    checks.push("role addresses match the proposal");
  }

  const chainId = await params.rpc.getChainId();
  if (chainId !== 84_532) {
    throw new DeploymentEvidenceError(`RPC chain ${chainId} is not Base Sepolia (84532).`);
  }
  checks.push("RPC chain is 84532");

  for (const step of params.proposal.contracts) {
    const name = step.name;
    const evidence = params.evidence.contracts[name];
    if (evidence === undefined) {
      failures.push(`${name}: no deployment evidence supplied`);
      continue;
    }
    if (/^0x0{40}$/.test(evidence.address)) {
      failures.push(`${name}: zero address is not a deployment`);
      continue;
    }
    const artifact = params.artifacts[name.startsWith("TestStock:") ? "TestStock" : name];
    if (artifact === undefined) {
      failures.push(`${name}: compiled artifact is missing`);
      continue;
    }

    const receipt = await params.rpc.getTransactionReceipt(evidence.transactionHash);
    if (receipt === null) {
      failures.push(`${name}: deployment transaction receipt is missing`);
      continue;
    }
    if (receipt.status !== "success") {
      failures.push(`${name}: deployment transaction reverted`);
    }
    if (
      receipt.contractAddress === null ||
      !sameAddress(receipt.contractAddress, evidence.address)
    ) {
      failures.push(`${name}: receipt contract address does not match the supplied address`);
    } else {
      checks.push(`${name}: receipt matches the supplied address`);
    }
    const confirmations = Number((await params.rpc.getBlockNumber()) - receipt.blockNumber) + 1;
    if (confirmations < minConfirmations) {
      failures.push(
        `${name}: deployment has ${confirmations} confirmations, needs ${minConfirmations}`,
      );
    }
    const canonical = await params.rpc.getBlock(receipt.blockNumber);
    if (canonical.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
      failures.push(`${name}: deployment receipt block is no longer canonical`);
    } else {
      checks.push(`${name}: deployment block is canonical with ${confirmations} confirmations`);
    }

    const code = await params.rpc.getCode(evidence.address);
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

    const transaction = await params.rpc.getTransaction(evidence.transactionHash);
    if (transaction === null) {
      failures.push(`${name}: deployment transaction body is unavailable`);
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
        if (transaction.input.toLowerCase() !== expectedInitcode.toLowerCase()) {
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
        if (keccak256(creationInTransaction) !== step.bytecodeHash) {
          failures.push(`${name}: creation bytecode does not match the proposal hash`);
        }
        if (keccak256(artifact.bytecode) !== step.bytecodeHash) {
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
    const decimals = await params.rpc.readDecimals(usdcEvidence.address);
    if (decimals !== 6) failures.push("TestUSDC: decimals are not 6");
    const name = await params.rpc.readName(usdcEvidence.address);
    if (name !== "KYROX Test USD") failures.push("TestUSDC: unexpected name");
    const symbol = await params.rpc.readSymbol(usdcEvidence.address);
    if (symbol !== "tUSDC") failures.push("TestUSDC: unexpected symbol");
    if (
      !(await params.rpc.hasRole(
        usdcEvidence.address,
        "DEFAULT_ADMIN_ROLE",
        params.evidence.roles.admin,
      ))
    ) {
      failures.push("TestUSDC: admin role missing");
    } else {
      checks.push("TestUSDC: metadata and admin role verified");
    }
  }

  for (const asset of params.proposal.assets) {
    const key = `TestStock:${asset.symbol}`;
    const evidence = params.evidence.contracts[key];
    if (evidence === undefined) continue;
    const decimals = await params.rpc.readDecimals(evidence.address);
    const name = await params.rpc.readName(evidence.address);
    const symbol = await params.rpc.readSymbol(evidence.address);
    if (decimals !== asset.decimals) failures.push(`${key}: decimals mismatch`);
    if (name !== asset.name) failures.push(`${key}: name mismatch`);
    if (symbol !== asset.symbol) failures.push(`${key}: symbol mismatch`);
    if (
      !(await params.rpc.hasRole(
        evidence.address,
        "DEFAULT_ADMIN_ROLE",
        params.evidence.roles.admin,
      ))
    ) {
      failures.push(`${key}: admin role missing`);
    } else {
      checks.push(`${key}: metadata and admin role verified`);
    }
    if (exchangeEvidence !== undefined) {
      if (
        !(await params.rpc.hasRole(evidence.address, "EXCHANGE_ROLE", exchangeEvidence.address))
      ) {
        failures.push(`${key}: exchange mint/burn role missing`);
      } else {
        checks.push(`${key}: exchange role verified`);
      }
    }
  }

  if (exchangeEvidence !== undefined && usdcEvidence !== undefined) {
    const exchange = exchangeEvidence.address;
    const usdc = await params.rpc.readUsdc(exchange);
    if (!sameAddress(usdc, usdcEvidence.address)) {
      failures.push("KyroxExchange: settlement token mismatch");
    } else {
      checks.push("KyroxExchange: settlement token verified");
    }
    for (const role of ["DEFAULT_ADMIN_ROLE", "PRICE_UPDATER_ROLE", "PAUSER_ROLE"] as const) {
      const account =
        role === "DEFAULT_ADMIN_ROLE"
          ? params.evidence.roles.admin
          : role === "PRICE_UPDATER_ROLE"
            ? params.evidence.roles.priceUpdater
            : params.evidence.roles.pauser;
      if (!(await params.rpc.hasRole(exchange, role, account))) {
        failures.push(`KyroxExchange: ${role} missing`);
      }
    }
    checks.push("KyroxExchange: admin, updater and pauser roles verified");

    if (await params.rpc.readPaused(exchange)) {
      failures.push("KyroxExchange: exchange is paused after deployment");
    } else {
      checks.push("KyroxExchange: exchange is not paused");
    }

    for (const asset of params.proposal.assets) {
      const token = params.evidence.contracts[`TestStock:${asset.symbol}`]?.address;
      if (token === undefined) continue;
      const settings = await params.rpc.readAssetSettings(exchange, token);
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
    checks.push("KyroxExchange: asset listing configuration verified");
  }

  if (exchangeEvidence !== undefined && usdcEvidence !== undefined) {
    if (
      !(await params.rpc.hasRole(usdcEvidence.address, "EXCHANGE_ROLE", exchangeEvidence.address))
    ) {
      failures.push("TestUSDC: exchange burn/mint role missing");
    } else {
      checks.push("TestUSDC: exchange role verified");
    }
  }

  for (const name of Object.keys(params.evidence.contracts)) {
    if (!name.startsWith("TestStock:") && name !== "TestUSDC") continue;
    const token = params.evidence.contracts[name]?.address;
    if (token === undefined) continue;
    const supply = await params.rpc.readTotalSupply(token);
    if (supply !== 0n) {
      failures.push(`${name}: constructor minted an unexpected initial supply`);
    } else {
      checks.push(`${name}: initial supply is zero`);
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
