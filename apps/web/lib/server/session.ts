import { cookies } from "next/headers";

import type { EnvironmentInfo, SessionPayload } from "../market-types.js";
import { isDemoMode, readDemoSession } from "../demo/session.js";
import { requireSession } from "./auth.js";
import { authStore } from "./store-singleton.js";

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
 * connection while the app runs in preview mode.
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
  } catch {
    return null;
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

export function environmentInfo(): EnvironmentInfo {
  if (isDemoMode()) {
    return {
      mode: "demo",
      simulated: true,
      chainId: 84_532,
      chainName: "Base Sepolia",
      contracts: "not-deployed",
      pricePublication: "simulated",
      appVersion: "preview-1.0",
      walletConnect: true,
    };
  }
  const local = (process.env["KYROX_ENVIRONMENT"] ?? "").trim() === "local-anvil";
  return {
    mode: local ? "local-anvil" : "base-sepolia",
    simulated: local,
    chainId: 84_532,
    chainName: local ? "Base Sepolia (local Anvil)" : "Base Sepolia",
    contracts: local ? "local" : "deployed",
    pricePublication: "configured",
    appVersion: "preview-1.0",
    walletConnect: true,
  };
}
