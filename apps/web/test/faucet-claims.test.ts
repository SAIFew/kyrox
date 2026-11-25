import { describe, expect, it } from "vitest";

import { FAUCET_CLAIMS, faucetClaim, faucetEligibility } from "../lib/faucet.js";
import type { EnvironmentInfo, SessionPayload } from "../lib/market-types.js";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;

function environment(overrides: Partial<EnvironmentInfo> = {}): EnvironmentInfo {
  return {
    mode: "base-sepolia",
    simulated: false,
    chainId: 84_532,
    chainName: "Base Sepolia",
    walletRpcUrl: null,
    walletNetworkName: "Base Sepolia",
    contracts: "deployed",
    pricePublication: "configured",
    appVersion: "test",
    walletConnect: false,
    ...overrides,
  };
}

function session(overrides: Partial<SessionPayload> = {}): SessionPayload {
  return {
    address: ADDRESS,
    expiresAt: 1_800_000_000,
    demo: false,
    ...overrides,
  };
}

describe("test-USDC faucet guards", () => {
  it("publishes exactly the welcome and daily contract claims", () => {
    expect(FAUCET_CLAIMS.map((claim) => claim.kind)).toEqual(["welcome", "daily"]);
    expect(FAUCET_CLAIMS.map((claim) => claim.functionName)).toEqual([
      "claimWelcome",
      "claimDaily",
    ]);
    expect(faucetClaim("welcome").amountLabel).toBe("1,000 tUSDC");
    expect(faucetClaim("daily").amountLabel).toBe("100 tUSDC");
    expect(() => faucetClaim("weekly" as never)).toThrow(/Unknown faucet claim/);
  });

  it("allows a live deployed or local testnet wallet session", () => {
    expect(faucetEligibility(environment(), session())).toEqual({
      allowed: true,
      reason: null,
    });
    expect(faucetEligibility(environment({ contracts: "local" }), session())).toEqual({
      allowed: true,
      reason: null,
    });
  });

  it("keeps demo mode strictly off-chain", () => {
    expect(faucetEligibility(environment({ mode: "demo" }), session({ demo: true }))).toEqual({
      allowed: false,
      reason: "Demo mode never sends wallet transactions.",
    });
    expect(faucetEligibility(environment(), session({ demo: true }))).toEqual({
      allowed: false,
      reason: "Demo mode never sends wallet transactions.",
    });
  });

  it("fails closed without a session, environment, or deployment", () => {
    expect(faucetEligibility(environment(), null).allowed).toBe(false);
    expect(faucetEligibility(null, session()).allowed).toBe(false);
    expect(faucetEligibility(environment({ contracts: "not-deployed" }), session())).toEqual({
      allowed: false,
      reason: "The test settlement contract is not deployed in this environment.",
    });
  });
});
