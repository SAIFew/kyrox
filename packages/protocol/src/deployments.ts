import { readFileSync } from "node:fs";

import type { Address } from "@kyrox/core";

export class DeploymentError extends Error {
  override readonly name = "DeploymentError";

  constructor(
    readonly code:
      | "MISSING_DEPLOYMENT"
      | "INVALID_DEPLOYMENT"
      | "WRONG_CHAIN"
      | "WRONG_ENVIRONMENT"
      | "NON_LOOPBACK_RPC",
    message: string,
  ) {
    super(message);
  }
}

export interface ContractDeployment {
  readonly address: Address;
  readonly deployedAt?: number;
  readonly verified?: boolean;
  /** Per-asset configuration recorded at deployment time. */
  readonly maxSourceAgeSeconds?: number;
  readonly maxPriceDeviationBps?: number;
  readonly minPriceUsdcPerWholeToken?: string;
  readonly maxPriceUsdcPerWholeToken?: string;
}

export interface DeploymentManifest {
  readonly chainId: number;
  readonly chain: string;
  readonly environment: string;
  readonly status: string;
  readonly rpcUrl?: string;
  readonly contracts: Readonly<Record<string, ContractDeployment>>;
  /** Per-synthetic-asset stock token addresses, e.g. `{ tAAPL: { address } }`. */
  readonly assets: Readonly<Record<string, ContractDeployment>>;
  readonly notes?: readonly string[];
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function parseContractMap(input: unknown, label: string): Record<string, ContractDeployment> {
  if (input === undefined) return {};
  if (typeof input !== "object" || input === null) {
    throw new DeploymentError("INVALID_DEPLOYMENT", `${label} map is malformed.`);
  }
  const parsed: Record<string, ContractDeployment> = {};
  for (const [name, entry] of Object.entries(input as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) {
      throw new DeploymentError("INVALID_DEPLOYMENT", `${label} entry ${name} is malformed.`);
    }
    const contract = entry as Record<string, unknown>;
    if (typeof contract.address !== "string") {
      throw new DeploymentError("INVALID_DEPLOYMENT", `${label} ${name} has no address.`);
    }
    parsed[name] = {
      address: assertSepoliaAddress(contract.address, `${label} ${name}`),
      ...(typeof contract.deployedAt === "number" ? { deployedAt: contract.deployedAt } : {}),
      ...(typeof contract.verified === "boolean" ? { verified: contract.verified } : {}),
      ...(typeof contract.maxSourceAgeSeconds === "number"
        ? { maxSourceAgeSeconds: contract.maxSourceAgeSeconds }
        : {}),
      ...(typeof contract.maxPriceDeviationBps === "number"
        ? { maxPriceDeviationBps: contract.maxPriceDeviationBps }
        : {}),
      ...(typeof contract.minPriceUsdcPerWholeToken === "string"
        ? { minPriceUsdcPerWholeToken: contract.minPriceUsdcPerWholeToken }
        : {}),
      ...(typeof contract.maxPriceUsdcPerWholeToken === "string"
        ? { maxPriceUsdcPerWholeToken: contract.maxPriceUsdcPerWholeToken }
        : {}),
    };
  }
  return parsed;
}

export function isLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:") return false;
    return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function assertSepoliaAddress(address: string, label: string): Address {
  if (!ADDRESS_PATTERN.test(address) || /^0x0{40}$/.test(address)) {
    throw new DeploymentError("INVALID_DEPLOYMENT", `${label} is not a valid non-zero address.`);
  }
  return address as Address;
}

/**
 * Validate a deployment manifest.
 *
 * A manifest is only usable for Base Sepolia. Any other chain id is a hard
 * failure so a mainnet address can never be read as a testnet deployment.
 */
export function parseDeploymentManifest(
  value: unknown,
  expectedChainId = 84_532,
): DeploymentManifest {
  if (typeof value !== "object" || value === null) {
    throw new DeploymentError("INVALID_DEPLOYMENT", "Deployment manifest must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (record.chainId !== expectedChainId) {
    throw new DeploymentError(
      "WRONG_CHAIN",
      `Deployment manifest chainId ${String(record.chainId)} is not ${expectedChainId}.`,
    );
  }

  const contracts = parseContractMap(record.contracts, "Contract");
  const assets = parseContractMap(record.assets, "Asset");

  const rpcRecord =
    typeof record.rpc === "object" && record.rpc !== null
      ? (record.rpc as Record<string, unknown>)
      : undefined;
  const rpcUrl = typeof rpcRecord?.url === "string" ? rpcRecord.url : undefined;

  return {
    chainId: expectedChainId,
    chain: typeof record.chain === "string" ? record.chain : "base-sepolia",
    environment: typeof record.environment === "string" ? record.environment : "unknown",
    status: typeof record.status === "string" ? record.status : "unpopulated",
    ...(rpcUrl !== undefined ? { rpcUrl } : {}),
    contracts,
    assets,
    ...(Array.isArray(record.notes)
      ? { notes: record.notes.filter((note): note is string => typeof note === "string") }
      : {}),
  };
}

export function loadDeploymentManifest(path: string): DeploymentManifest {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new DeploymentError("MISSING_DEPLOYMENT", `Deployment manifest not found at ${path}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DeploymentError("INVALID_DEPLOYMENT", `Deployment manifest at ${path} is not JSON.`);
  }
  return parseDeploymentManifest(parsed);
}

/**
 * Resolve the exchange address, or fail closed.
 *
 * Phase 1 has no deployment, so publication preparation must refuse rather than
 * invent an address.
 */
export function requireExchangeAddress(
  manifest: DeploymentManifest,
  contractName = "KyroxExchange",
): Address {
  const contract = manifest.contracts[contractName];
  if (contract === undefined) {
    throw new DeploymentError(
      "MISSING_DEPLOYMENT",
      `No ${contractName} address is recorded for chain ${manifest.chainId}.`,
    );
  }
  return contract.address;
}

/** Resolve a synthetic asset's stock token address, or fail closed. */
export function requireAssetAddress(manifest: DeploymentManifest, assetSymbol: string): Address {
  const asset = manifest.assets[assetSymbol];
  if (asset === undefined) {
    throw new DeploymentError(
      "MISSING_DEPLOYMENT",
      `No stock token address is recorded for ${assetSymbol}.`,
    );
  }
  return asset.address;
}

/**
 * A local rehearsal manifest must say so and must point at loopback.
 * A chain id alone never proves a real Sepolia deployment.
 */
export function assertLocalManifest(manifest: DeploymentManifest): void {
  if (manifest.environment !== "local-anvil") {
    throw new DeploymentError(
      "WRONG_ENVIRONMENT",
      `Manifest environment is "${manifest.environment}", not "local-anvil".`,
    );
  }
  if (manifest.rpcUrl === undefined || !isLoopbackUrl(manifest.rpcUrl)) {
    throw new DeploymentError(
      "NON_LOOPBACK_RPC",
      "A local-anvil manifest must declare a loopback RPC URL.",
    );
  }
}
