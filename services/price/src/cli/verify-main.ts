import { pathToFileURL } from "node:url";

import { createDatabase } from "@kyrox/db";
import {
  createViemChainIdentityProvider,
  loadDeploymentManifest,
  verifyChainIdentity,
} from "@kyrox/protocol";
import type { Hex } from "viem";

import { createSepoliaVerificationClient } from "../feeds/viem-client.js";
import { DrizzleObservationStore } from "../persistence/drizzle-store.js";
import { VerificationError, verifyPublication } from "../verification/verify.js";

export interface VerifyCliArgs {
  readonly assetSymbol: string;
  readonly sourceRoundId: bigint;
  readonly txHash: Hex;
  readonly minConfirmations: number;
  readonly rpcUrl: string;
  readonly databaseUrl: string;
  readonly manifestPath: string;
  readonly secondaryRpcUrl: string;
}

export class VerifyConfigError extends Error {
  override readonly name = "VerifyConfigError";
}

export function parseVerifyArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): VerifyCliArgs {
  const read = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const assetSymbol = read("--asset")?.trim() ?? "";
  const roundRaw = read("--round")?.trim() ?? "";
  const txHash = read("--tx-hash")?.trim() ?? "";
  if (assetSymbol.length === 0) throw new VerifyConfigError("--asset is required.");
  if (!/^\d+$/.test(roundRaw)) throw new VerifyConfigError("--round must be a positive integer.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new VerifyConfigError("--tx-hash must be a 32-byte hex hash.");
  }

  const rpcUrl = env["BASE_SEPOLIA_RPC_URL"]?.trim() ?? "";
  if (rpcUrl.length === 0) {
    throw new VerifyConfigError("BASE_SEPOLIA_RPC_URL is required.");
  }
  const secondaryRpcUrl = env["BASE_SEPOLIA_RPC_URL_SECONDARY"]?.trim() ?? "";
  if (secondaryRpcUrl.length === 0) {
    throw new VerifyConfigError("BASE_SEPOLIA_RPC_URL_SECONDARY is required.");
  }
  if (secondaryRpcUrl === rpcUrl) {
    throw new VerifyConfigError("Primary and secondary RPC URLs must differ.");
  }
  const databaseUrl = env["DATABASE_URL"]?.trim() ?? "";
  if (databaseUrl.length === 0) throw new VerifyConfigError("DATABASE_URL is required.");

  const confirmationsRaw = read("--confirmations") ?? env["VERIFY_CONFIRMATIONS"] ?? "3";
  const minConfirmations = Number(confirmationsRaw);
  if (!Number.isInteger(minConfirmations) || minConfirmations < 1) {
    throw new VerifyConfigError("Confirmation threshold must be a positive integer.");
  }

  return {
    assetSymbol,
    sourceRoundId: BigInt(roundRaw),
    txHash: txHash as Hex,
    minConfirmations,
    rpcUrl,
    databaseUrl,
    manifestPath: env["KYROX_DEPLOYMENT_MANIFEST"]?.trim() || "deployments/base-sepolia.json",
    secondaryRpcUrl,
  };
}

export function verifyExitCode(state: string): number {
  switch (state) {
    case "verified":
      return 0;
    case "included":
      return 4;
    case "pending":
      return 3;
    case "unavailable":
      return 5;
    default:
      return 1;
  }
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  let args: VerifyCliArgs;
  try {
    args = parseVerifyArgs(argv, env);
  } catch (error) {
    console.error(`Configuration error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  let handle: ReturnType<typeof createDatabase>;
  try {
    handle = createDatabase(args.databaseUrl);
    await handle.pool.query("SELECT 1");
  } catch (error) {
    console.error(
      `Database initialisation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }

  try {
    const manifest = loadDeploymentManifest(args.manifestPath);
    const store = new DrizzleObservationStore(handle.db);
    const rpc = createSepoliaVerificationClient(args.rpcUrl);
    const chainIdentity = await verifyChainIdentity([
      createViemChainIdentityProvider("primary", args.rpcUrl),
      createViemChainIdentityProvider("secondary", args.secondaryRpcUrl),
    ]);

    const report = await verifyPublication({
      assetSymbol: args.assetSymbol,
      sourceRoundId: args.sourceRoundId,
      txHash: args.txHash,
      manifest,
      store,
      rpc,
      minConfirmations: args.minConfirmations,
      mode: "production",
      chainIdentity,
    });

    console.log(JSON.stringify(report, null, 2));
    return verifyExitCode(report.state);
  } catch (error) {
    if (error instanceof VerificationError) {
      console.error(`Verification failed: ${error.message}`);
      return 1;
    }
    console.error(`Verification error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  } finally {
    await handle.pool.end();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
