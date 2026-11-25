import type { Address } from "@kyrox/core";
import { keccak256, toHex, type Hex } from "viem";

import type { DeploymentRoles, ProposedDeploymentManifest } from "./deployment-plan.js";
import type {
  DeploymentEvidence,
  DeploymentVerificationReport,
} from "./deployment-verification.js";
import {
  DeploymentError,
  parseDeploymentManifest,
  type DeploymentManifest,
} from "./deployments.js";

export interface PendingContractRecord {
  readonly address: Address;
  readonly transactionHash: Hex;
  readonly runtimeBytecodeHash: Hex;
  readonly blockNumber: string;
  readonly blockHash: Hex;
}

export interface PendingDeploymentRecord {
  readonly environment: "base-sepolia";
  readonly status: "verified_pending_activation";
  readonly planningStatus: "not_deployed";
  readonly chainId: 84_532;
  readonly proposalHash: Hex;
  readonly createdAt: string;
  /** Keccak-256 commitment to every verification-bound field below. */
  readonly integrityHash: Hex;
  readonly roles: DeploymentRoles;
  readonly contracts: Readonly<Record<string, PendingContractRecord>>;
  readonly assets: Readonly<
    Record<
      string,
      {
        readonly stockToken: Address;
        readonly decimals: number;
        readonly maxSourceAgeSeconds: number;
        readonly maxPriceDeviationBps: number;
        readonly minPriceUsdcPerWholeToken: string;
        readonly maxPriceUsdcPerWholeToken: string;
      }
    >
  >;
}

export class ManifestActivationError extends Error {
  override readonly name = "ManifestActivationError";
}

type PendingIntegrityPayload = Omit<PendingDeploymentRecord, "integrityHash">;

function pendingIntegrityPayload(record: PendingIntegrityPayload): PendingIntegrityPayload {
  return {
    environment: record.environment,
    status: record.status,
    planningStatus: record.planningStatus,
    chainId: record.chainId,
    proposalHash: record.proposalHash,
    createdAt: record.createdAt,
    roles: {
      admin: record.roles.admin,
      priceUpdater: record.roles.priceUpdater,
      pauser: record.roles.pauser,
      deployer: record.roles.deployer,
    },
    contracts: Object.fromEntries(
      Object.entries(record.contracts)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, contract]) => [
          name,
          {
            address: contract.address,
            transactionHash: contract.transactionHash,
            runtimeBytecodeHash: contract.runtimeBytecodeHash,
            blockNumber: contract.blockNumber,
            blockHash: contract.blockHash,
          },
        ]),
    ),
    assets: Object.fromEntries(
      Object.entries(record.assets)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([symbol, asset]) => [
          symbol,
          {
            stockToken: asset.stockToken,
            decimals: asset.decimals,
            maxSourceAgeSeconds: asset.maxSourceAgeSeconds,
            maxPriceDeviationBps: asset.maxPriceDeviationBps,
            minPriceUsdcPerWholeToken: asset.minPriceUsdcPerWholeToken,
            maxPriceUsdcPerWholeToken: asset.maxPriceUsdcPerWholeToken,
          },
        ]),
    ),
  };
}

function pendingIntegrityHash(record: PendingIntegrityPayload): Hex {
  return keccak256(toHex(JSON.stringify(pendingIntegrityPayload(record))));
}

export function buildPendingDeploymentRecord(params: {
  readonly proposal: ProposedDeploymentManifest;
  readonly proposalHash: Hex;
  readonly evidence: DeploymentEvidence;
  readonly verification: DeploymentVerificationReport;
  readonly createdAt: string;
}): PendingDeploymentRecord {
  if (!params.verification.ok) {
    throw new ManifestActivationError(
      "Deployment verification did not pass; no pending record may be recorded.",
    );
  }
  if (params.evidence.proposalHash.toLowerCase() !== params.proposalHash.toLowerCase()) {
    throw new ManifestActivationError("Evidence proposal hash does not match.");
  }
  if (
    params.evidence.roles.admin.toLowerCase() !== params.proposal.roles.admin.toLowerCase() ||
    params.evidence.roles.priceUpdater.toLowerCase() !==
      params.proposal.roles.priceUpdater.toLowerCase() ||
    params.evidence.roles.pauser.toLowerCase() !== params.proposal.roles.pauser.toLowerCase() ||
    params.evidence.roles.deployer.toLowerCase() !== params.proposal.roles.deployer.toLowerCase()
  ) {
    throw new ManifestActivationError("Evidence roles do not match the proposal.");
  }

  const contracts: Record<string, PendingContractRecord> = {};
  for (const step of params.proposal.contracts) {
    const evidence = params.evidence.contracts[step.name];
    const verified = params.verification.contracts[step.name];
    if (evidence === undefined || verified === undefined) {
      throw new ManifestActivationError(`${step.name} has no verified deployment evidence.`);
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(evidence.address) || /^0x0{40}$/i.test(evidence.address)) {
      throw new ManifestActivationError(`${step.name} has a zero or malformed address.`);
    }
    if (verified.address.toLowerCase() !== evidence.address.toLowerCase()) {
      throw new ManifestActivationError(`${step.name} verification does not match its evidence.`);
    }
    contracts[step.name] = {
      address: evidence.address,
      transactionHash: evidence.transactionHash,
      runtimeBytecodeHash: verified.runtimeBytecodeHash,
      blockNumber: verified.blockNumber,
      blockHash: verified.blockHash,
    };
  }

  const assets: Record<string, PendingDeploymentRecord["assets"][string]> = {};
  for (const asset of params.proposal.assets) {
    const contract = contracts[`TestStock:${asset.symbol}`];
    if (contract === undefined) {
      throw new ManifestActivationError(`No verified token for ${asset.symbol}.`);
    }
    assets[asset.symbol] = {
      stockToken: contract.address,
      decimals: asset.decimals,
      maxSourceAgeSeconds: asset.freshness.maxSourceAgeSeconds,
      maxPriceDeviationBps: asset.priceBounds.maxPriceDeviationBps,
      minPriceUsdcPerWholeToken: asset.priceBounds.minPriceUsdcPerWholeToken,
      maxPriceUsdcPerWholeToken: asset.priceBounds.maxPriceUsdcPerWholeToken,
    };
  }

  const record: PendingDeploymentRecord = {
    environment: "base-sepolia",
    status: "verified_pending_activation",
    planningStatus: "not_deployed",
    chainId: 84_532,
    proposalHash: params.proposalHash,
    createdAt: params.createdAt,
    integrityHash: `0x${"00".repeat(32)}`,
    roles: params.evidence.roles,
    contracts,
    assets,
  };
  const committed: PendingDeploymentRecord = {
    ...record,
    integrityHash: pendingIntegrityHash(record),
  };
  validatePendingRecord(committed);
  return committed;
}

export function validatePendingRecord(record: PendingDeploymentRecord): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(record.integrityHash)) {
    throw new ManifestActivationError("Pending record has no valid integrity hash.");
  }
  const { integrityHash, ...payload } = record;
  if (integrityHash.toLowerCase() !== pendingIntegrityHash(payload).toLowerCase()) {
    throw new ManifestActivationError("Pending record integrity hash does not match its contents.");
  }
  if (record.environment !== "base-sepolia" || record.chainId !== 84_532) {
    throw new ManifestActivationError("Pending record is not Base Sepolia.");
  }
  if (record.status !== "verified_pending_activation" || record.planningStatus !== "not_deployed") {
    throw new ManifestActivationError("Pending record has not passed deployment verification.");
  }
  for (const [name, contract] of Object.entries(record.contracts)) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(contract.address) || /^0x0{40}$/.test(contract.address)) {
      throw new ManifestActivationError(`${name} has an invalid address.`);
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(contract.transactionHash)) {
      throw new ManifestActivationError(`${name} has an invalid transaction hash.`);
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(contract.runtimeBytecodeHash)) {
      throw new ManifestActivationError(`${name} has an invalid bytecode hash.`);
    }
    if (
      !/^[1-9]\d*$/.test(contract.blockNumber) ||
      !Number.isSafeInteger(Number(contract.blockNumber)) ||
      !/^0x[0-9a-fA-F]{64}$/.test(contract.blockHash)
    ) {
      throw new ManifestActivationError(`${name} has invalid inclusion block evidence.`);
    }
  }
  for (const required of ["TestUSDC", "KyroxExchange"]) {
    if (record.contracts[required] === undefined) {
      throw new ManifestActivationError(`Pending record is missing ${required}.`);
    }
  }
  if (Object.keys(record.assets).length === 0) {
    throw new ManifestActivationError("Pending record has no verified assets.");
  }
  for (const [symbol, asset] of Object.entries(record.assets)) {
    const contract = record.contracts[`TestStock:${symbol}`];
    if (
      contract === undefined ||
      contract.address.toLowerCase() !== asset.stockToken.toLowerCase()
    ) {
      throw new ManifestActivationError(`${symbol} is not bound to its verified token.`);
    }
    if (
      !Number.isInteger(asset.decimals) ||
      asset.decimals <= 0 ||
      asset.decimals > 77 ||
      !Number.isInteger(asset.maxSourceAgeSeconds) ||
      asset.maxSourceAgeSeconds <= 0 ||
      asset.maxSourceAgeSeconds > 604_800 ||
      !Number.isInteger(asset.maxPriceDeviationBps) ||
      asset.maxPriceDeviationBps <= 0 ||
      asset.maxPriceDeviationBps > 10_000 ||
      typeof asset.minPriceUsdcPerWholeToken !== "string" ||
      typeof asset.maxPriceUsdcPerWholeToken !== "string" ||
      !/^[1-9]\d*$/.test(asset.minPriceUsdcPerWholeToken) ||
      !/^[1-9]\d*$/.test(asset.maxPriceUsdcPerWholeToken) ||
      BigInt(asset.minPriceUsdcPerWholeToken) > BigInt(asset.maxPriceUsdcPerWholeToken)
    ) {
      throw new ManifestActivationError(`${symbol} is missing a complete verified configuration.`);
    }
  }
  for (const role of Object.values(record.roles)) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(role) || /^0x0{40}$/i.test(role)) {
      throw new ManifestActivationError("Pending record has an invalid role address.");
    }
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(record.proposalHash) || /^0x0{64}$/i.test(record.proposalHash)) {
    throw new ManifestActivationError("Pending record has no proposal hash.");
  }
}

/** Convert a fully verified pending record into the production manifest shape. */
export function pendingToManifest(record: PendingDeploymentRecord): DeploymentManifest {
  validatePendingRecord(record);

  const contracts: Record<string, { address: Address; verified: boolean }> = {};
  for (const [name, contract] of Object.entries(record.contracts)) {
    contracts[name] = { address: contract.address, verified: true };
  }
  const assets: Record<
    string,
    {
      address: Address;
      verified: boolean;
      maxSourceAgeSeconds: number;
      maxPriceDeviationBps: number;
      minPriceUsdcPerWholeToken: string;
      maxPriceUsdcPerWholeToken: string;
    }
  > = {};
  for (const [symbol, asset] of Object.entries(record.assets)) {
    assets[symbol] = {
      address: asset.stockToken,
      verified: true,
      maxSourceAgeSeconds: asset.maxSourceAgeSeconds,
      maxPriceDeviationBps: asset.maxPriceDeviationBps,
      minPriceUsdcPerWholeToken: asset.minPriceUsdcPerWholeToken,
      maxPriceUsdcPerWholeToken: asset.maxPriceUsdcPerWholeToken,
    };
  }

  const manifest: DeploymentManifest = {
    chainId: 84_532,
    chain: "base-sepolia",
    environment: "base-sepolia",
    status: "deployed",
    contracts,
    assets,
    notes: [`proposalHash=${record.proposalHash}`],
  };

  // The production loader must accept the promoted manifest.
  parseDeploymentManifest(manifest);
  return manifest;
}

export interface ManifestIo {
  readFile(path: string): string;
  writeFile(path: string, contents: string): void;
  exists(path: string): boolean;
}

export interface PromoteManifestParams {
  readonly record: PendingDeploymentRecord;
  readonly expectedProposalHash: Hex;
  readonly targetPath: string;
  /** Operator must pass true explicitly. */
  readonly confirmed: boolean;
  /** Required to replace an existing deployed manifest. */
  readonly overwriteApproved?: boolean;
  readonly io: ManifestIo;
  readonly now: Date;
}

export interface PromoteManifestResult {
  readonly written: boolean;
  readonly backupPath?: string;
}

/**
 * Write the live manifest only after explicit confirmation. An existing deployed
 * manifest is never replaced silently; a timestamped backup is written first.
 */
export function promotePendingManifest(params: PromoteManifestParams): PromoteManifestResult {
  if (!params.confirmed) {
    throw new ManifestActivationError(
      "Manifest activation requires explicit operator confirmation.",
    );
  }
  if (params.record.proposalHash !== params.expectedProposalHash) {
    throw new ManifestActivationError("Pending record was not verified against this proposal.");
  }
  const manifest = pendingToManifest(params.record);

  let backupPath: string | undefined;
  if (params.io.exists(params.targetPath)) {
    const existingRaw = params.io.readFile(params.targetPath);
    let existing: DeploymentManifest | null = null;
    try {
      existing = parseDeploymentManifest(JSON.parse(existingRaw));
    } catch (error) {
      if (!(error instanceof DeploymentError)) throw error;
    }
    const isLive = existing !== null && existing.status !== "unpopulated";
    if (isLive && params.overwriteApproved !== true) {
      throw new ManifestActivationError(
        "A deployed manifest already exists; pass explicit overwrite approval to replace it.",
      );
    }
    const stamp = params.now.toISOString().replace(/[^0-9]/g, "");
    backupPath = `${params.targetPath}.bak.${stamp}`;
    params.io.writeFile(backupPath, existingRaw);
  }

  params.io.writeFile(params.targetPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { written: true, ...(backupPath !== undefined ? { backupPath } : {}) };
}
