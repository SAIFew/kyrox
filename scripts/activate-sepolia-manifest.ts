import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { createPublicClient, http, keccak256, toHex } from "viem";

import {
  createViemChainIdentityProvider,
  promotePendingManifest,
  verifyChainIdentity,
  type ManifestIo,
  type PendingDeploymentRecord,
} from "@kyrox/protocol";

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
    await verifyChainIdentity([
      createViemChainIdentityProvider("primary", rpcUrl),
      createViemChainIdentityProvider("secondary", secondaryUrl),
    ]);

    const pending = JSON.parse(readFileSync(PENDING_PATH, "utf8")) as PendingDeploymentRecord;
    const client = createPublicClient({
      chain: {
        id: 84_532,
        name: "Base Sepolia",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      },
      transport: http(rpcUrl, { timeout: 20_000, retryCount: 1 }),
    });
    const requiredConfirmations = Number(process.env["DEPLOYMENT_CONFIRMATIONS"] ?? "12");
    const latest = await client.getBlockNumber();
    for (const [name, contract] of Object.entries(pending.contracts)) {
      const receipt = await client.getTransactionReceipt({
        hash: contract.transactionHash as `0x${string}`,
      });
      if (
        receipt.status !== "success" ||
        receipt.contractAddress?.toLowerCase() !== contract.address.toLowerCase() ||
        receipt.blockNumber.toString() !== contract.blockNumber ||
        receipt.blockHash.toLowerCase() !== contract.blockHash.toLowerCase()
      ) {
        throw new Error(`${name}: deployment receipt no longer matches verified evidence.`);
      }
      const confirmations = Number(latest - receipt.blockNumber) + 1;
      if (confirmations < requiredConfirmations) {
        throw new Error(
          `${name}: only ${confirmations} confirmations, need ${requiredConfirmations}.`,
        );
      }
      const code = await client.getCode({ address: contract.address });
      if (code === undefined || code === "0x") {
        throw new Error(`${name}: no code at the verified address.`);
      }
    }
    const proposalRaw = readFileSync(PROPOSAL_PATH, "utf8");
    const proposalHash = keccak256(toHex(proposalRaw));

    const result = promotePendingManifest({
      record: pending,
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
