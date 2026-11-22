import type { Address } from "@kyrox/core";
import {
  assertLocalManifest,
  isLoopbackUrl,
  loadDeploymentManifest,
  parseDeploymentManifest,
  type DeploymentManifest,
} from "@kyrox/protocol";

export interface RuntimeEnvironment {
  readonly mode: "local-anvil" | "base-sepolia";
  readonly manifestPath: string;
  readonly rpcUrl: string;
  readonly databaseUrl: string;
  readonly quoteSecret: string;
  readonly manifest: DeploymentManifest;
}

export class EnvironmentError extends Error {
  override readonly name = "EnvironmentError";
}

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) throw new EnvironmentError(`${name} is required.`);
  return trimmed;
}

/**
 * Resolve the runtime environment with an explicit local/production split.
 * A local manifest is never accepted as a production deployment and vice versa.
 */
export function loadEnvironment(): RuntimeEnvironment {
  const rawMode = (process.env["KYROX_ENVIRONMENT"] ?? "local-anvil").trim();
  if (rawMode !== "local-anvil" && rawMode !== "base-sepolia") {
    throw new EnvironmentError(`Unsupported KYROX_ENVIRONMENT: ${rawMode}`);
  }

  const databaseUrl = required(process.env["DATABASE_URL"], "DATABASE_URL");
  const quoteSecret = required(process.env["AUTH_SECRET"], "AUTH_SECRET (server-side only)");
  if (quoteSecret.length < 32) {
    throw new EnvironmentError("AUTH_SECRET must contain at least 32 characters.");
  }

  if (rawMode === "local-anvil") {
    const manifestPath =
      process.env["KYROX_DEPLOYMENT_MANIFEST"]?.trim() || "deployments/local-anvil.json";
    const rpcUrl = required(process.env["BASE_SEPOLIA_RPC_URL"], "BASE_SEPOLIA_RPC_URL");
    if (!isLoopbackUrl(rpcUrl)) {
      throw new EnvironmentError("Local Anvil mode requires an explicit loopback RPC URL.");
    }
    const manifest = loadDeploymentManifest(manifestPath);
    assertLocalManifest(manifest);
    return { mode: "local-anvil", manifestPath, rpcUrl, databaseUrl, quoteSecret, manifest };
  }

  const manifestPath =
    process.env["KYROX_DEPLOYMENT_MANIFEST"]?.trim() || "deployments/base-sepolia.json";
  const rpcUrl = required(process.env["BASE_SEPOLIA_RPC_URL"], "BASE_SEPOLIA_RPC_URL");
  const manifest = loadDeploymentManifest(manifestPath);
  if (manifest.environment !== "base-sepolia" || manifest.status !== "deployed") {
    throw new EnvironmentError(
      "Production mode requires an approved base-sepolia manifest with status deployed.",
    );
  }
  return { mode: "base-sepolia", manifestPath, rpcUrl, databaseUrl, quoteSecret, manifest };
}

export function exchangeAddress(env: RuntimeEnvironment): Address {
  const exchange = env.manifest.contracts["KyroxExchange"]?.address;
  if (exchange === undefined) throw new EnvironmentError("The deployment has no exchange address.");
  return exchange;
}

export function settlementToken(env: RuntimeEnvironment): Address {
  const address = env.manifest.contracts["TestUSDC"]?.address;
  if (address === undefined) throw new EnvironmentError("The deployment has no TestUSDC address.");
  return address;
}

export function assetAddress(env: RuntimeEnvironment, symbol: string): Address {
  const asset = env.manifest.assets[symbol];
  if (asset === undefined) throw new EnvironmentError(`No deployed stock token for ${symbol}.`);
  return asset.address;
}

export function loadManifestText(path: string): DeploymentManifest {
  return parseDeploymentManifest(JSON.parse(path));
}
