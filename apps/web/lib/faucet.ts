import type { EnvironmentInfo, SessionPayload } from "./market-types";

/**
 * Test-USDC faucet definitions. The contract enforces the actual limits:
 * one 1,000 tUSDC welcome grant per wallet and 100 tUSDC per rolling day.
 * The UI copies these labels only; it never mints anything by itself.
 */
export type FaucetClaimKind = "welcome" | "daily";

export interface FaucetClaimDefinition {
  readonly kind: FaucetClaimKind;
  readonly amountLabel: string;
  readonly title: string;
  readonly description: string;
  readonly functionName: "claimWelcome" | "claimDaily";
}

export const FAUCET_CLAIMS: readonly FaucetClaimDefinition[] = [
  {
    kind: "welcome",
    amountLabel: "1,000 tUSDC",
    title: "Welcome grant",
    description: "Once per wallet. Claim 1,000 free test tUSDC.",
    functionName: "claimWelcome",
  },
  {
    kind: "daily",
    amountLabel: "100 tUSDC",
    title: "Daily claim",
    description: "Once per rolling 24 hours, per wallet.",
    functionName: "claimDaily",
  },
] as const;

export interface FaucetEligibility {
  readonly allowed: boolean;
  readonly reason: string | null;
}

/**
 * Fail closed: the faucet action is only offered for a signed-in, live testnet
 * session with a usable deployment. Demo mode stays strictly off-chain.
 */
export function faucetEligibility(
  environment: EnvironmentInfo | null | undefined,
  session: SessionPayload | null | undefined,
): FaucetEligibility {
  if (session === null || session === undefined) {
    return { allowed: false, reason: "Sign in with a wallet to claim test USDC." };
  }
  if (session.demo) {
    return { allowed: false, reason: "Demo mode never sends wallet transactions." };
  }
  if (environment === null || environment === undefined) {
    return { allowed: false, reason: "The environment is still loading." };
  }
  if (environment.mode === "demo") {
    return { allowed: false, reason: "Demo mode never sends wallet transactions." };
  }
  if (environment.contracts !== "deployed" && environment.contracts !== "local") {
    return {
      allowed: false,
      reason: "The test settlement contract is not deployed in this environment.",
    };
  }
  return { allowed: true, reason: null };
}

export function faucetClaim(kind: FaucetClaimKind): FaucetClaimDefinition {
  const claim = FAUCET_CLAIMS.find((entry) => entry.kind === kind);
  if (claim === undefined) throw new Error(`Unknown faucet claim: ${kind}.`);
  return claim;
}
