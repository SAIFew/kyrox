/** Human-readable labels for the product UI. API and contract symbols stay unchanged. */
import type { EnvironmentInfo } from "./market-types";

const ASSET_NAMES: Readonly<Record<string, string>> = {
  tAAPL: "Test Apple",
  tNVDA: "Test NVIDIA",
  tMSFT: "Test Microsoft",
  tGOOGL: "Test Google",
  tAMZN: "Test Amazon",
  tTSLA: "Test Tesla",
  tMETA: "Test Meta",
  tUSDC: "Test USDC",
};

export function assetDisplayName(symbol: string): string {
  return ASSET_NAMES[symbol] ?? symbol;
}

export function settlementDisplayName(): string {
  return ASSET_NAMES.tUSDC ?? "Test USDC";
}

export function isDemoEnvironment(environment: EnvironmentInfo | null | undefined): boolean {
  return environment?.mode === "demo";
}

export function environmentShortLabel(environment: EnvironmentInfo | null | undefined): string {
  switch (environment?.mode) {
    case "demo":
      return "Demo · simulated";
    case "local-anvil":
      return "Anvil · testnet";
    case "base-sepolia":
      return "Base Sepolia";
    default:
      return environment === null || environment === undefined
        ? "Checking environment"
        : `Testnet · chain ${environment.chainId}`;
  }
}

export function environmentLabel(environment: EnvironmentInfo | null | undefined): string {
  switch (environment?.mode) {
    case "demo":
      return "Demo · simulated off-chain venue";
    case "local-anvil":
      return `${environment.chainName} · simulated testnet`;
    case "base-sepolia":
      return `${environment.chainName} testnet`;
    default:
      return environmentShortLabel(environment);
  }
}

export function environmentDisclosure(environment: EnvironmentInfo | null | undefined): string {
  switch (environment?.mode) {
    case "demo":
      return "Demo environment: prices and balances are simulated, fills stay off-chain, and no contracts are deployed.";
    case "local-anvil":
      return "Local Anvil testnet: settlement uses local contracts, while prices and balances are simulated. No real funds.";
    case "base-sepolia":
      if (environment.contracts === "deployed") {
        return `Base Sepolia testnet: settlement uses deployed testnet contracts.${
          environment.pricePublication === "simulated" ? " Reference prices are simulated." : ""
        } Testnet assets have no real-world value.`;
      }
      return `Base Sepolia testnet: contracts are not deployed in this environment, so on-chain settlement is unavailable.${
        environment.pricePublication === "simulated" ? " Reference prices are simulated." : ""
      }`;
    default:
      return "Checking the environment. Simulation and testnet qualifications appear with each observation.";
  }
}

export function priceSourceLabel(environment: EnvironmentInfo | null | undefined): string {
  switch (environment?.mode) {
    case "demo":
      return "simulated reference feed";
    case "local-anvil":
      return "simulated local reference feed";
    case "base-sepolia":
      return environment.pricePublication === "simulated"
        ? "simulated reference feed"
        : "configured reference feed";
    default:
      return "reference feed · checking";
  }
}

export function observationBadge(
  environment: EnvironmentInfo | null | undefined,
  observation?: { readonly simulated?: boolean | null } | null,
): string {
  if (environment === null || environment === undefined) return "checking";
  if (observation?.simulated === true || environment.simulated === true) return "simulated";
  return "testnet";
}

export function contractsLabel(environment: EnvironmentInfo | null | undefined): string {
  switch (environment?.contracts) {
    case "deployed":
      return "deployed · testnet";
    case "local":
      return "local contracts only";
    case "not-deployed":
      return "not deployed";
    default:
      return "checking";
  }
}

export function balanceQualification(environment: EnvironmentInfo | null | undefined): string {
  if (environment === null || environment === undefined) return "balance environment unavailable";
  return environment.simulated ? "simulated balances" : "testnet balances";
}

export function transactionExplorerUrl(
  environment: EnvironmentInfo | null | undefined,
  txHash: string,
): string | null {
  if (environment?.mode !== "base-sepolia" || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) return null;
  return `https://sepolia.basescan.org/tx/${txHash}`;
}
