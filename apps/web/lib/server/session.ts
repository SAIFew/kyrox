import { cookies } from "next/headers";

import type { EnvironmentInfo, SessionPayload } from "../market-types.js";
import { isDemoMode, readDemoSession } from "../demo/session.js";
import { AuthError, requireSession } from "./auth.js";
import { loadEnvironment, type RuntimeEnvironment } from "./env.js";
import { authStore } from "./store-singleton.js";

const PUBLIC_BASE_SEPOLIA_RPC_URL = "https://sepolia.base.org";

function publicLocalRpcUrl(rpcUrl: string): string {
  const parsed = new URL(rpcUrl);
  if (parsed.username.length === 0 && parsed.password.length === 0 && parsed.search === "") {
    return rpcUrl;
  }
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

export interface AppSession {
  readonly address: `0x${string}`;
  readonly expiresAt: number;
  readonly demo: boolean;
}

function toAppSession(input: {
  address: string;
  expiresAt: Date | number;
  demo: boolean;
}): AppSession {
  const expiresAt =
    input.expiresAt instanceof Date
      ? Math.floor(input.expiresAt.getTime() / 1_000)
      : input.expiresAt;
  return { address: input.address as `0x${string}`, expiresAt, demo: input.demo };
}

/**
 * Single session accessor for both persistence modes.
 *
 * Demo sessions are authenticated, HMAC-sealed cookies. Live sessions are the
 * existing database-backed sessions; this helper never creates a database
 * connection while the app runs in preview mode. Dependency failures are not
 * disguised as an unauthenticated session.
 */
export async function getSession(): Promise<AppSession | null> {
  if (isDemoMode()) {
    const demo = await readDemoSession();
    return demo === null ? null : toAppSession(demo);
  }
  try {
    const store = authStore();
    const storeCookies = await cookies();
    const session = await requireSession(store, storeCookies.get("kyrox_session")?.value);
    if (session === null) return null;
    return toAppSession({ address: session.address, expiresAt: session.expiresAt, demo: false });
  } catch (err) {
    if (err instanceof AuthError && err.code === "SESSION_EXPIRED") return null;
    throw err;
  }
}

export function toSessionPayload(session: AppSession | null): SessionPayload | null {
  if (session === null) return null;
  return {
    address: session.address,
    expiresAt: session.expiresAt,
    demo: session.demo,
  };
}

/**
 * Describe the validated runtime, not raw environment defaults. Wallet RPC
 * metadata is always public: server-side credential-bearing RPC URLs are never
 * returned to the browser.
 */
export function environmentInfo(env?: RuntimeEnvironment): EnvironmentInfo {
  const walletConnect = Boolean(process.env["NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID"]?.trim());
  if (isDemoMode()) {
    return {
      mode: "demo",
      simulated: true,
      chainId: 84_532,
      chainName: "Base Sepolia",
      walletRpcUrl: PUBLIC_BASE_SEPOLIA_RPC_URL,
      walletNetworkName: "Base Sepolia",
      contracts: "not-deployed",
      pricePublication: "simulated",
      appVersion: "preview-1.0",
      walletConnect,
    };
  }

  const resolved = env ?? loadEnvironment();
  const local = resolved.mode === "local-anvil";
  const walletNetworkName = local ? "Base Sepolia (local Anvil)" : "Base Sepolia";
  return {
    mode: resolved.mode,
    simulated: local,
    chainId: resolved.manifest.chainId,
    chainName: walletNetworkName,
    walletRpcUrl: local ? publicLocalRpcUrl(resolved.rpcUrl) : PUBLIC_BASE_SEPOLIA_RPC_URL,
    walletNetworkName,
    contracts: local ? "local" : "deployed",
    pricePublication: Object.keys(resolved.manifest.assets).length > 0 ? "configured" : "simulated",
    appVersion: "preview-1.0",
    walletConnect,
  };
}
