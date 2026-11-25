import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createPublicClient,
  encodeDeployData,
  http,
  keccak256,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import { TESTNET_ASSETS } from "@kyrox/core";
import {
  DeploymentPlanError,
  buildDeploymentPlan,
  createViemChainIdentityProvider,
  verifyChainIdentity,
  type ChainIdentityEvidence,
  type ContractArtifactInfo,
  type DeploymentPlan,
  type DeploymentRoles,
} from "@kyrox/protocol";

import { feedForAsset } from "../services/price/src/feeds/registry.js";

const TARGET_CHAIN_ID = 84_532;
const PROPOSED_MANIFEST_PATH = "deployments/base-sepolia.proposed.json";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

class DryRunConfigError extends Error {
  override readonly name = "DryRunConfigError";
}

interface ArtifactFile {
  readonly abi: Abi;
  readonly bytecode: { readonly object: Hex };
  readonly deployedBytecode: { readonly object: Hex };
  readonly metadata: string | object;
}

interface ArtifactMetadata {
  readonly compilerVersion: string;
  readonly optimizer: boolean;
  readonly optimizerRuns: number;
  readonly evmVersion: string;
}

function artifactPath(name: string): string {
  return fileURLToPath(
    new URL(`../packages/contracts/out/${name}.sol/${name}.json`, import.meta.url),
  );
}

function readArtifact(name: string): {
  artifact: ArtifactFile;
  info: ContractArtifactInfo;
  metadata: ArtifactMetadata;
} {
  const artifact = JSON.parse(readFileSync(artifactPath(name), "utf8")) as ArtifactFile;
  const metadata = (
    typeof artifact.metadata === "string" ? JSON.parse(artifact.metadata) : artifact.metadata
  ) as {
    compiler?: { version?: string };
    settings?: {
      optimizer?: { enabled?: boolean; runs?: number };
      evmVersion?: string;
    };
  };
  const parsed: ArtifactMetadata = {
    compilerVersion: metadata.compiler?.version ?? "unknown",
    optimizer: metadata.settings?.optimizer?.enabled ?? false,
    optimizerRuns: metadata.settings?.optimizer?.runs ?? 0,
    evmVersion: metadata.settings?.evmVersion ?? "unknown",
  };
  return {
    artifact,
    info: {
      name,
      bytecodeHash: keccak256(artifact.bytecode.object),
      ...parsed,
    },
    metadata: parsed,
  };
}

function parseDeviationConfig(raw: string | undefined): Map<string, number> {
  const value = raw?.trim() ?? "";
  if (value.length === 0) {
    throw new DryRunConfigError(
      "SEPOLIA_DEVIATION_BPS is required, e.g. 'tAAPL:500,tNVDA:500,tMSFT:500,tGOOGL:500,tAMZN:500,tTSLA:500,tMETA:500'.",
    );
  }
  const parsed = new Map<string, number>();
  for (const entry of value.split(",")) {
    const [symbol, bpsRaw] = entry.split(":");
    const bps = Number(bpsRaw);
    if (symbol === undefined || !Number.isInteger(bps) || bps <= 0 || bps > 10_000) {
      throw new DryRunConfigError(`Invalid deviation entry "${entry}".`);
    }
    parsed.set(symbol.trim(), bps);
  }
  return parsed;
}

function requireAddress(env: Readonly<Record<string, string | undefined>>, key: string): Address {
  const value = env[key]?.trim() ?? "";
  if (!ADDRESS_PATTERN.test(value) || /^0x0{40}$/.test(value)) {
    throw new DryRunConfigError(`${key} must be an explicit non-zero address.`);
  }
  return value as Address;
}

export interface DryRunDeps {
  readonly verifyIdentity: () => Promise<ChainIdentityEvidence>;
  readonly estimateGas?: (request: { account: Address; data: Hex }) => Promise<bigint>;
  readonly writeManifest?: (path: string, contents: string) => void;
}

export async function runDryRun(
  env: Readonly<Record<string, string | undefined>>,
  deps: DryRunDeps,
): Promise<DeploymentPlan> {
  const rpcUrl = env["BASE_SEPOLIA_RPC_URL"]?.trim() ?? "";
  if (rpcUrl.length === 0) {
    throw new DryRunConfigError("BASE_SEPOLIA_RPC_URL is required.");
  }

  const roles: DeploymentRoles = {
    admin: requireAddress(env, "SEPOLIA_ADMIN_ADDRESS"),
    priceUpdater: requireAddress(env, "SEPOLIA_PRICE_UPDATER_ADDRESS"),
    pauser: requireAddress(env, "SEPOLIA_PAUSER_ADDRESS"),
    deployer: requireAddress(env, "SEPOLIA_DEPLOYER_ADDRESS"),
  };

  await deps.verifyIdentity();

  const deviation = parseDeviationConfig(env["SEPOLIA_DEVIATION_BPS"]);

  const usdc = readArtifact("TestUSDC");
  const stock = readArtifact("TestStock");
  const exchange = readArtifact("KyroxExchange");

  const assets = TESTNET_ASSETS.filter((asset) => asset.listed).map((asset) => {
    const feed = feedForAsset(asset.symbol);
    const bps = deviation.get(asset.symbol);
    if (bps === undefined) {
      throw new DryRunConfigError(`SEPOLIA_DEVIATION_BPS must define ${asset.symbol}.`);
    }
    return {
      symbol: asset.symbol,
      name: asset.name,
      decimals: asset.stockDecimals,
      feedAddress: feed.feedAddress,
      feedDescription: feed.expectedDescription,
      sourceChainId: feed.expectedChainId,
      verifiedAt: feed.verifiedAt,
      maxSourceAgeSeconds: 600,
      minPriceUsdcPerWholeToken: 1n,
      maxPriceUsdcPerWholeToken: 10n ** 12n,
      maxPriceDeviationBps: bps,
    };
  });

  const gasEstimates: Record<string, string | null> = {};
  const gasEstimateFailures: Record<string, string> = {};
  if (deps.estimateGas !== undefined) {
    const deployable: Array<{ key: string; artifact: ArtifactFile; args: readonly unknown[] }> = [
      { key: "TestUSDC", artifact: usdc.artifact, args: [roles.admin] },
      ...assets.map((asset) => ({
        key: `TestStock:${asset.symbol}`,
        artifact: stock.artifact,
        args: [asset.name, asset.symbol, asset.decimals, roles.admin],
      })),
    ];
    for (const entry of deployable) {
      try {
        const data = encodeDeployData({
          abi: entry.artifact.abi,
          bytecode: entry.artifact.bytecode.object,
          args: entry.args,
        });
        gasEstimates[entry.key] = (
          await deps.estimateGas({ account: roles.deployer, data })
        ).toString();
      } catch (error) {
        gasEstimates[entry.key] = null;
        gasEstimateFailures[entry.key] = redactRpcSecrets(
          error instanceof Error ? error.message : String(error),
          [rpcUrl, env["BASE_SEPOLIA_RPC_URL_SECONDARY"]?.trim() ?? ""],
        );
      }
    }
    gasEstimates["KyroxExchange"] = null;
    gasEstimateFailures["KyroxExchange"] = "constructor requires the deployed TestUSDC address";
  }

  const plan = buildDeploymentPlan({
    roles,
    assets,
    artifacts: {
      TestUSDC: usdc.info,
      TestStock: stock.info,
      KyroxExchange: exchange.info,
    },
    createdAt: new Date().toISOString(),
    gasEstimates,
    gasEstimateFailures,
  });

  const write = deps.writeManifest ?? ((path, contents) => writeFileSync(path, contents));
  write(PROPOSED_MANIFEST_PATH, `${JSON.stringify(plan.manifest, null, 2)}\n`);

  return plan;
}

export function redactRpcUrl(rpcUrl: string): string {
  try {
    const parsed = new URL(rpcUrl);
    if (parsed.host.length === 0) return "[redacted]";
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "[redacted]";
  }
}

export function redactRpcSecrets(message: string, rpcUrls: readonly string[]): string {
  let redacted = message;
  for (const rpcUrl of rpcUrls) {
    if (rpcUrl.length === 0) continue;
    redacted = redacted.split(rpcUrl).join(redactRpcUrl(rpcUrl));
  }
  return redacted;
}

export function formatHumanDeploymentPlan(plan: DeploymentPlan, rpcUrl: string): string {
  const lines: string[] = [
    "KYROX — Base Sepolia deployment dry run",
    "=======================================",
    "NO DEPLOYMENT TRANSACTION WAS SUBMITTED.",
    "NO CONTRACT ADDRESS IS LIVE.",
    "NO ROLE CONFIGURATION HAS BEEN APPLIED.",
    "NO PRICE HAS BEEN PUBLISHED.",
    "NO MANIFEST IS APPROVED FOR PRODUCTION USE.",
    "",
    "Target chain: 84532 (Base Sepolia) — verified via RPC",
    `RPC: ${redactRpcUrl(rpcUrl)}`,
    "Chain identity: genesis and checkpoint pinned; two providers agreed.",
    `Deployer: ${plan.roles.deployer}`,
    "",
    "Deployment order:",
  ];
  for (const [index, step] of plan.steps.entries()) {
    lines.push(
      `${index + 1}. ${step.contractName} (${step.compiler.compilerVersion}, optimizer=${String(
        step.compiler.optimizer,
      )}/${step.compiler.optimizerRuns}, evm=${step.compiler.evmVersion})`,
    );
    lines.push(`   args: ${JSON.stringify(step.constructorArgs)}`);
    lines.push(`   creation bytecode: ${step.bytecodeHash}`);
    lines.push(`   dependencies: ${step.dependencies.join(", ") || "none"}`);
    lines.push(`   estimated gas: ${step.estimatedGas ?? "unavailable"}`);
  }
  lines.push("", "Role grants:", ...plan.roleGrants.map((grant) => `- ${grant}`));
  lines.push("", "Asset configuration:", ...plan.assetConfiguration.map((entry) => `- ${entry}`));
  if (plan.warnings.length > 0) {
    lines.push("", "Warnings:", ...plan.warnings.map((warning) => `! ${warning}`));
  }
  lines.push(
    "",
    `Proposed manifest written to ${PROPOSED_MANIFEST_PATH} (planning artifact, not a deployment).`,
  );
  return lines.join("\n");
}

async function main(argv: readonly string[]): Promise<number> {
  const env = process.env;
  const rpcUrl = env["BASE_SEPOLIA_RPC_URL"]?.trim() ?? "";
  const secondaryUrl = env["BASE_SEPOLIA_RPC_URL_SECONDARY"]?.trim() ?? "";
  try {
    if (secondaryUrl.length === 0) {
      throw new DryRunConfigError(
        "BASE_SEPOLIA_RPC_URL_SECONDARY is required for independent chain identity verification.",
      );
    }
    if (secondaryUrl === rpcUrl) {
      throw new DryRunConfigError("Primary and secondary RPC URLs must not be identical.");
    }
    const client =
      rpcUrl.length > 0
        ? createPublicClient({
            chain: {
              id: TARGET_CHAIN_ID,
              name: "Base Sepolia",
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: { default: { http: [rpcUrl] } },
            },
            transport: http(rpcUrl, { timeout: 15_000, retryCount: 0 }),
          })
        : undefined;

    const primaryProvider = createViemChainIdentityProvider("primary", rpcUrl);
    const secondaryProvider = createViemChainIdentityProvider("secondary", secondaryUrl);

    const plan = await runDryRun(env, {
      verifyIdentity: () => verifyChainIdentity([primaryProvider, secondaryProvider]),
      ...(client !== undefined
        ? {
            estimateGas: async (request: { account: Address; data: Hex }) =>
              client.estimateGas({ account: request.account, data: request.data }),
          }
        : {}),
    });

    if (!argv.includes("--json")) {
      console.log(formatHumanDeploymentPlan(plan, rpcUrl));
      console.log("\n--- JSON PLAN ---");
    }
    console.log(JSON.stringify(plan, null, 2));
    return 0;
  } catch (error) {
    if (error instanceof DryRunConfigError || error instanceof DeploymentPlanError) {
      console.error(`Dry run refused: ${error.message}`);
      return 2;
    }
    console.error(
      `Dry run failed: ${redactRpcSecrets(error instanceof Error ? error.message : String(error), [
        rpcUrl,
        secondaryUrl,
      ])}`,
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
