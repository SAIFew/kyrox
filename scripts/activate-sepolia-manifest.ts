import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { keccak256, toHex } from "viem";

import {
  buildPendingDeploymentRecord,
  createViemChainIdentityProvider,
  promotePendingManifest,
  validatePendingRecord,
  verifyChainIdentity,
  verifyDeployment,
  type DeploymentEvidence,
  type ManifestIo,
  type PendingDeploymentRecord,
  type ProposedDeploymentManifest,
} from "@kyrox/protocol";

import {
  clientFor,
  loadArtifact,
  parseDeploymentConfirmations,
} from "./verify-sepolia-deployment.js";

const PENDING_PATH = "deployments/base-sepolia.verified-pending.json";
const PROPOSAL_PATH = "deployments/base-sepolia.proposed.json";
const TARGET_PATH = "deployments/base-sepolia.json";

const io: ManifestIo = {
  readFile: (path) => readFileSync(path, "utf8"),
  writeFile: (path, contents) => writeFileSync(path, contents),
  exists: (path) => existsSync(path),
};

async function main(argv: readonly string[]): Promise<number> {
  const confirmed = argv.includes("--confirm");
  const overwrite = argv.includes("--overwrite");

  try {
    const rpcUrl = process.env["BASE_SEPOLIA_RPC_URL"]?.trim() ?? "";
    const secondaryUrl = process.env["BASE_SEPOLIA_RPC_URL_SECONDARY"]?.trim() ?? "";
    if (rpcUrl.length === 0 || secondaryUrl.length === 0 || rpcUrl === secondaryUrl) {
      throw new Error(
        "BASE_SEPOLIA_RPC_URL and BASE_SEPOLIA_RPC_URL_SECONDARY must be set and distinct.",
      );
    }
    const requiredConfirmations = parseDeploymentConfirmations(
      process.env["DEPLOYMENT_CONFIRMATIONS"],
    );

    const pending = JSON.parse(readFileSync(PENDING_PATH, "utf8")) as PendingDeploymentRecord;
    validatePendingRecord(pending);
    const proposalRaw = readFileSync(PROPOSAL_PATH, "utf8");
    const proposal = JSON.parse(proposalRaw) as ProposedDeploymentManifest;
    const proposalHash = keccak256(toHex(proposalRaw));
    if (pending.proposalHash.toLowerCase() !== proposalHash.toLowerCase()) {
      throw new Error("Pending record is not bound to the current reviewed proposal.");
    }

    const chainIdentity = await verifyChainIdentity([
      createViemChainIdentityProvider("primary", rpcUrl),
      createViemChainIdentityProvider("secondary", secondaryUrl),
    ]);
    const evidence: DeploymentEvidence = {
      environment: "base-sepolia",
      chainId: 84_532,
      proposalHash: pending.proposalHash,
      roles: pending.roles,
      contracts: Object.fromEntries(
        Object.entries(pending.contracts).map(([name, contract]) => [
          name,
          { address: contract.address, transactionHash: contract.transactionHash },
        ]),
      ),
    };

    // Reperform the complete verification immediately before promotion. This
    // covers receipts, bytecode, role history, pause state, settlement linkage,
    // asset settings and historical constructor supply on both independent RPCs.
    const verification = await verifyDeployment({
      evidence,
      proposal,
      artifacts: {
        TestUSDC: loadArtifact("TestUSDC"),
        TestStock: loadArtifact("TestStock"),
        KyroxExchange: loadArtifact("KyroxExchange"),
      },
      rpc: clientFor(rpcUrl),
      secondaryRpc: clientFor(secondaryUrl),
      expectedProposalHash: proposalHash,
      chainIdentity,
      minConfirmations: requiredConfirmations,
    });
    if (!verification.ok) {
      throw new Error(`Fresh deployment verification failed: ${verification.failures.join("; ")}`);
    }

    for (const [name, contract] of Object.entries(pending.contracts)) {
      const fresh = verification.contracts[name];
      if (fresh === undefined) throw new Error(`${name}: fresh verification produced no evidence.`);
      if (
        fresh.address.toLowerCase() !== contract.address.toLowerCase() ||
        fresh.runtimeBytecodeHash.toLowerCase() !== contract.runtimeBytecodeHash.toLowerCase() ||
        fresh.blockNumber !== contract.blockNumber ||
        fresh.blockHash.toLowerCase() !== contract.blockHash.toLowerCase()
      ) {
        throw new Error(`${name}: current deployment no longer matches pending verified evidence.`);
      }
    }

    const refreshed = buildPendingDeploymentRecord({
      proposal,
      proposalHash,
      evidence,
      verification,
      createdAt: pending.createdAt,
    });
    if (refreshed.integrityHash.toLowerCase() !== pending.integrityHash.toLowerCase()) {
      throw new Error("Pending record changed after its original verification.");
    }

    const result = promotePendingManifest({
      record: refreshed,
      expectedProposalHash: proposalHash,
      targetPath: TARGET_PATH,
      confirmed,
      overwriteApproved: overwrite,
      io,
      now: new Date(),
    });

    console.log(
      JSON.stringify(
        { activated: result.written, target: TARGET_PATH, backup: result.backupPath ?? null },
        null,
        2,
      ),
    );
    return 0;
  } catch (error) {
    console.error(
      `Manifest activation refused: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
