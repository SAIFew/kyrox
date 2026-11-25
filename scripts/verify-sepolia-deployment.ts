import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { createPublicClient, http, keccak256, parseAbi, parseAbiItem, toHex, type Hex } from "viem";

import {
  buildPendingDeploymentRecord,
  createViemChainIdentityProvider,
  verifyChainIdentity,
  verifyDeployment,
  type DeploymentArtifact,
  type DeploymentEvidence,
  type DeploymentVerifierRpc,
  type ProposedDeploymentManifest,
} from "@kyrox/protocol";

const PROPOSAL_PATH = "deployments/base-sepolia.proposed.json";
const EVIDENCE_PATH = "deployments/base-sepolia.deployment-evidence.json";
const PENDING_PATH = "deployments/base-sepolia.verified-pending.json";

const ACCESS_CONTROL_ABI = parseAbi([
  "function hasRole(bytes32 role, address account) view returns (bool)",
]);
const TOKEN_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
]);
const EXCHANGE_ABI = parseAbi([
  "function usdc() view returns (address)",
  "function paused() view returns (bool)",
  "function assetSettings(address stockToken) view returns (bool listed, uint8 stockDecimals, uint32 maxSourceAgeSeconds, uint16 maxPriceDeviationBps, uint256 minPriceUsdcPerWholeToken, uint256 maxPriceUsdcPerWholeToken)",
]);
const HISTORY_EVENTS = [
  parseAbiItem(
    "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
  ),
  parseAbiItem(
    "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
  ),
  parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
];

const ROLE_HASH: Record<string, Hex> = {
  DEFAULT_ADMIN_ROLE: `0x${"00".repeat(32)}`,
  EXCHANGE_ROLE: keccak256(toHex("KYROX_EXCHANGE_ROLE")),
  PRICE_UPDATER_ROLE: keccak256(toHex("KYROX_PRICE_UPDATER_ROLE")),
  PAUSER_ROLE: keccak256(toHex("KYROX_PAUSER_ROLE")),
};

function artifactPath(name: string): string {
  return `packages/contracts/out/${name}.sol/${name}.json`;
}

export function loadArtifact(name: string): DeploymentArtifact {
  const raw = JSON.parse(readFileSync(artifactPath(name), "utf8")) as {
    abi: DeploymentArtifact["abi"];
    bytecode: { object: Hex };
    deployedBytecode: { object: Hex };
    immutableReferences?: Record<string, { start: number; length: number }[]>;
  };
  return {
    abi: raw.abi,
    bytecode: raw.bytecode.object,
    deployedBytecode: raw.deployedBytecode.object,
    immutableReferences: raw.immutableReferences ?? {},
  };
}

export function parseDeploymentConfirmations(raw: string | undefined): number {
  const value = raw === undefined ? "12" : raw.trim();
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error("DEPLOYMENT_CONFIRMATIONS must be a positive safe integer.");
  }
  return Number(value);
}

export function clientFor(rpcUrl: string): DeploymentVerifierRpc {
  const client = createPublicClient({
    chain: {
      id: 84_532,
      name: "Base Sepolia",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    },
    transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }),
  });

  return {
    getChainId: () => client.getChainId(),
    async getTransactionReceipt(txHash) {
      const receipt = await client.getTransactionReceipt({ hash: txHash });
      return {
        status: receipt.status,
        contractAddress: receipt.contractAddress ?? null,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
      };
    },
    async getTransaction(txHash) {
      const tx = await client.getTransaction({ hash: txHash });
      return { input: tx.input, from: tx.from };
    },
    getBlockNumber: () => client.getBlockNumber(),
    async getBlock(blockNumber) {
      const block = await client.getBlock({ blockNumber });
      if (block.hash === null) throw new Error(`Block ${blockNumber} has no hash.`);
      return { hash: block.hash, timestamp: Number(block.timestamp) };
    },
    getCode: async (address, blockNumber) =>
      (await client.getCode({ address, blockNumber })) ?? "0x",
    async getLogs({ address, fromBlock, toBlock }) {
      const logs: Array<Awaited<ReturnType<DeploymentVerifierRpc["getLogs"]>>[number]> = [];
      const chunkSize = 10_000n;
      for (let start = fromBlock; start <= toBlock; start += chunkSize) {
        const end = start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n;
        const page = await client.getLogs({
          address,
          fromBlock: start,
          toBlock: end,
          events: HISTORY_EVENTS,
          strict: true,
        });
        for (const log of page) {
          if (log.blockHash === null) throw new Error(`Log in block ${start} has no block hash.`);
          logs.push({
            address: log.address,
            topics: log.topics,
            data: log.data,
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
            transactionHash: log.transactionHash,
            blockHash: log.blockHash,
            removed: log.removed,
          });
        }
      }
      return logs.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
        return a.logIndex - b.logIndex;
      });
    },
    readDecimals: (address, blockNumber) =>
      client.readContract({ address, abi: TOKEN_ABI, functionName: "decimals", blockNumber }),
    readName: (address, blockNumber) =>
      client.readContract({ address, abi: TOKEN_ABI, functionName: "name", blockNumber }),
    readSymbol: (address, blockNumber) =>
      client.readContract({ address, abi: TOKEN_ABI, functionName: "symbol", blockNumber }),
    hasRole: (contract, role, account, blockNumber) =>
      client.readContract({
        address: contract,
        abi: ACCESS_CONTROL_ABI,
        functionName: "hasRole",
        args: [ROLE_HASH[role] as Hex, account],
        blockNumber,
      }),
    readUsdc: (exchange, blockNumber) =>
      client.readContract({
        address: exchange,
        abi: EXCHANGE_ABI,
        functionName: "usdc",
        blockNumber,
      }),
    readPaused: (exchange, blockNumber) =>
      client.readContract({
        address: exchange,
        abi: EXCHANGE_ABI,
        functionName: "paused",
        blockNumber,
      }),
    readTotalSupply: (token, blockNumber) =>
      client.readContract({
        address: token,
        abi: TOKEN_ABI,
        functionName: "totalSupply",
        blockNumber,
      }),
    async readAssetSettings(exchange, token, blockNumber) {
      const [listed, stockDecimals, maxSourceAgeSeconds, maxPriceDeviationBps, minPrice, maxPrice] =
        await client.readContract({
          address: exchange,
          abi: EXCHANGE_ABI,
          functionName: "assetSettings",
          args: [token],
          blockNumber,
        });
      return {
        listed,
        stockDecimals,
        maxSourceAgeSeconds,
        maxPriceDeviationBps,
        minPriceUsdcPerWholeToken: minPrice,
        maxPriceUsdcPerWholeToken: maxPrice,
      };
    },
  };
}

async function main(argv: readonly string[]): Promise<number> {
  const read = (flag: string, fallback: string): string => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] !== undefined ? (argv[index + 1] as string) : fallback;
  };
  const proposalPath = read("--proposal", PROPOSAL_PATH);
  const evidencePath = read("--evidence", EVIDENCE_PATH);
  const rpcUrl = process.env["BASE_SEPOLIA_RPC_URL"]?.trim() ?? "";
  const secondaryUrl = process.env["BASE_SEPOLIA_RPC_URL_SECONDARY"]?.trim() ?? "";
  if (rpcUrl.length === 0 || secondaryUrl.length === 0) {
    console.error("BASE_SEPOLIA_RPC_URL and BASE_SEPOLIA_RPC_URL_SECONDARY are required.");
    return 2;
  }
  if (rpcUrl === secondaryUrl) {
    console.error("Primary and secondary RPC URLs must differ.");
    return 2;
  }

  try {
    const proposalRaw = readFileSync(proposalPath, "utf8");
    const proposal = JSON.parse(proposalRaw) as ProposedDeploymentManifest;
    const proposalHash = keccak256(toHex(proposalRaw));
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as DeploymentEvidence;

    console.log(`Proposal hash: ${proposalHash}`);
    const chainIdentity = await verifyChainIdentity([
      createViemChainIdentityProvider("primary", rpcUrl),
      createViemChainIdentityProvider("secondary", secondaryUrl),
    ]);
    const minConfirmations = parseDeploymentConfirmations(process.env["DEPLOYMENT_CONFIRMATIONS"]);
    const report = await verifyDeployment({
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
      minConfirmations,
    });

    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) {
      console.error("Deployment verification failed; no pending record was written.");
      return 1;
    }

    const pending = buildPendingDeploymentRecord({
      proposal,
      proposalHash,
      evidence,
      verification: report,
      createdAt: new Date().toISOString(),
    });
    writeFileSync(PENDING_PATH, `${JSON.stringify(pending, null, 2)}\n`);
    console.log(
      `Verified pending record written to ${PENDING_PATH}. Activation is a separate command.`,
    );
    return 0;
  } catch (error) {
    console.error(
      `Deployment verification error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
