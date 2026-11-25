import type { Address } from "@kyrox/core";
import type { Hex } from "viem";

export interface ArtifactMetadata {
  readonly compilerVersion: string;
  readonly optimizer: boolean;
  readonly optimizerRuns: number;
  readonly evmVersion: string;
}

export interface ContractArtifactInfo extends ArtifactMetadata {
  readonly name: string;
  readonly bytecodeHash: Hex;
}

export interface DeploymentRoles {
  readonly admin: Address;
  readonly priceUpdater: Address;
  readonly pauser: Address;
  /** Address authorized to sign every deployment transaction. */
  readonly deployer: Address;
}

export interface DeploymentAssetInput {
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly feedAddress: Address;
  readonly feedDescription: string;
  readonly sourceChainId: number;
  readonly verifiedAt: string;
  readonly maxSourceAgeSeconds: number;
  readonly minPriceUsdcPerWholeToken: bigint;
  readonly maxPriceUsdcPerWholeToken: bigint;
  /** Non-zero round-to-round guard. Explicitly operator-supplied. */
  readonly maxPriceDeviationBps: number;
}

export interface DeploymentStep {
  readonly contractName: string;
  readonly address: null;
  readonly constructorArgs: readonly unknown[];
  readonly dependencies: readonly string[];
  readonly bytecodeHash: Hex;
  readonly compiler: ArtifactMetadata;
  readonly estimatedGas: string | null;
  readonly estimatedGasNote?: string;
  readonly postDeployment: readonly string[];
}

export interface ProposedDeploymentManifest {
  readonly environment: "base-sepolia-proposal";
  readonly status: "not_deployed";
  readonly planningOnly: true;
  readonly warning: string;
  readonly chainId: 84_532;
  readonly createdAt: string;
  readonly roles: DeploymentRoles;
  readonly compiler: ArtifactMetadata;
  readonly contracts: readonly {
    readonly name: string;
    readonly address: null;
    readonly bytecodeHash: Hex;
    readonly constructorArgs: readonly unknown[];
    readonly dependencies: readonly string[];
    readonly estimatedGas: string | null;
    readonly estimatedGasNote?: string;
    readonly postDeployment: readonly string[];
  }[];
  readonly assets: readonly {
    readonly symbol: string;
    readonly name: string;
    readonly decimals: number;
    readonly stockToken: null;
    readonly sourceChainId: number;
    readonly feed: {
      readonly address: Address;
      readonly description: string;
      readonly verifiedAt: string;
    };
    readonly freshness: { readonly maxSourceAgeSeconds: number };
    readonly priceBounds: {
      readonly minPriceUsdcPerWholeToken: string;
      readonly maxPriceUsdcPerWholeToken: string;
      readonly maxPriceDeviationBps: number;
    };
  }[];
}

export interface DeploymentPlan {
  readonly chainId: 84_532;
  readonly roles: DeploymentRoles;
  readonly steps: readonly DeploymentStep[];
  readonly roleGrants: readonly string[];
  readonly assetConfiguration: readonly string[];
  readonly gasEstimateFailures: Readonly<Record<string, string>>;
  readonly warnings: readonly string[];
  readonly manifest: ProposedDeploymentManifest;
}

export interface DeploymentPlanInput {
  readonly roles: DeploymentRoles;
  readonly assets: readonly DeploymentAssetInput[];
  readonly artifacts: Readonly<Record<string, ContractArtifactInfo>>;
  readonly createdAt: string;
  /** Optional safe estimates keyed by step name; null when unavailable. */
  readonly gasEstimates?: Readonly<Record<string, string | null>>;
  /** Human-readable failures retained instead of silently discarding estimates. */
  readonly gasEstimateFailures?: Readonly<Record<string, string>>;
}

export class DeploymentPlanError extends Error {
  override readonly name = "DeploymentPlanError";
}

function safeGasEstimate(value: string | null | undefined, name: string): string | null {
  if (value === undefined || value === null) return null;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new DeploymentPlanError(`${name} has an invalid gas estimate.`);
  }
  return value;
}

function gasFailureNote(
  failures: Readonly<Record<string, string>> | undefined,
  name: string,
): { readonly estimatedGasNote?: string } {
  const note = failures?.[name];
  return note === undefined ? {} : { estimatedGasNote: note };
}

const PROPOSAL_WARNING =
  "PLANNING ARTIFACT — no contract is deployed, no address is live, and this file must never be used as a deployment manifest. Base Sepolia deployment requires explicit approval.";

export function assertDeploymentChain(chainId: number): void {
  if (chainId === 8_453) {
    throw new DeploymentPlanError("Refusing to plan against Base Mainnet (8453).");
  }
  if (chainId === 31_337) {
    throw new DeploymentPlanError(
      "Refusing to plan against a local Anvil chain; the target is Base Sepolia (84532).",
    );
  }
  if (chainId !== 84_532) {
    throw new DeploymentPlanError(`Target chain ${chainId} is not Base Sepolia (84532).`);
  }
}

/** Build the canonical deployment plan and proposed manifest. Pure function. */
export function buildDeploymentPlan(input: DeploymentPlanInput): DeploymentPlan {
  const required = ["TestUSDC", "TestStock", "KyroxExchange"];
  for (const name of required) {
    if (input.artifacts[name] === undefined) {
      throw new DeploymentPlanError(`Missing compiled artifact for ${name}.`);
    }
  }

  const usdc = input.artifacts["TestUSDC"] as ContractArtifactInfo;
  const stock = input.artifacts["TestStock"] as ContractArtifactInfo;
  const exchange = input.artifacts["KyroxExchange"] as ContractArtifactInfo;

  const steps: DeploymentStep[] = [
    {
      contractName: "TestUSDC",
      address: null,
      constructorArgs: [input.roles.admin],
      dependencies: [],
      bytecodeHash: usdc.bytecodeHash,
      compiler: {
        compilerVersion: usdc.compilerVersion,
        optimizer: usdc.optimizer,
        optimizerRuns: usdc.optimizerRuns,
        evmVersion: usdc.evmVersion,
      },
      estimatedGas: safeGasEstimate(input.gasEstimates?.["TestUSDC"], "TestUSDC"),
      ...gasFailureNote(input.gasEstimateFailures, "TestUSDC"),
      postDeployment: [],
    },
    ...input.assets.map((asset) => ({
      contractName: `TestStock:${asset.symbol}`,
      address: null,
      constructorArgs: [asset.name, asset.symbol, asset.decimals, input.roles.admin],
      dependencies: [],
      bytecodeHash: stock.bytecodeHash,
      compiler: {
        compilerVersion: stock.compilerVersion,
        optimizer: stock.optimizer,
        optimizerRuns: stock.optimizerRuns,
        evmVersion: stock.evmVersion,
      },
      estimatedGas: safeGasEstimate(
        input.gasEstimates?.[`TestStock:${asset.symbol}`],
        `TestStock:${asset.symbol}`,
      ),
      ...gasFailureNote(input.gasEstimateFailures, `TestStock:${asset.symbol}`),
      postDeployment: [],
    })),
    {
      contractName: "KyroxExchange",
      address: null,
      constructorArgs: ["{{TestUSDC}}", input.roles.admin],
      dependencies: ["TestUSDC", ...input.assets.map((asset) => `TestStock:${asset.symbol}`)],
      bytecodeHash: exchange.bytecodeHash,
      compiler: {
        compilerVersion: exchange.compilerVersion,
        optimizer: exchange.optimizer,
        optimizerRuns: exchange.optimizerRuns,
        evmVersion: exchange.evmVersion,
      },
      estimatedGas: safeGasEstimate(input.gasEstimates?.["KyroxExchange"], "KyroxExchange"),
      estimatedGasNote:
        input.gasEstimateFailures?.["KyroxExchange"] ?? "Depends on the deployed TestUSDC address.",
      postDeployment: [
        "TestUSDC.grantRole(EXCHANGE_ROLE, {{KyroxExchange}})",
        ...input.assets.map(
          (asset) => `TestStock:${asset.symbol}.grantRole(EXCHANGE_ROLE, {{KyroxExchange}})`,
        ),
        `KyroxExchange.grantRole(PRICE_UPDATER_ROLE, ${input.roles.priceUpdater})`,
        `KyroxExchange.grantRole(PAUSER_ROLE, ${input.roles.pauser})`,
        ...input.assets.map(
          (asset) =>
            `KyroxExchange.listAsset({{TestStock:${asset.symbol}}}, ${asset.maxSourceAgeSeconds}, ${asset.minPriceUsdcPerWholeToken}, ${asset.maxPriceUsdcPerWholeToken}); KyroxExchange.setPriceBounds({{TestStock:${asset.symbol}}}, ${asset.minPriceUsdcPerWholeToken}, ${asset.maxPriceUsdcPerWholeToken}, ${asset.maxPriceDeviationBps})`,
        ),
      ],
    },
  ];

  const roleGrants = [
    `TestUSDC.grantRole(EXCHANGE_ROLE, {{KyroxExchange}})`,
    ...input.assets.map(
      (asset) => `TestStock:${asset.symbol}.grantRole(EXCHANGE_ROLE, {{KyroxExchange}})`,
    ),
    `KyroxExchange.grantRole(PRICE_UPDATER_ROLE, ${input.roles.priceUpdater})`,
    `KyroxExchange.grantRole(PAUSER_ROLE, ${input.roles.pauser})`,
    "<admin retains DEFAULT_ADMIN_ROLE on all contracts>",
  ];

  for (const asset of input.assets) {
    if (
      !Number.isInteger(asset.maxPriceDeviationBps) ||
      asset.maxPriceDeviationBps <= 0 ||
      asset.maxPriceDeviationBps > 10_000
    ) {
      throw new DeploymentPlanError(
        `Asset ${asset.symbol} requires an explicit non-zero maxPriceDeviationBps (1..10000).`,
      );
    }
  }

  const assetConfiguration = input.assets.map(
    (asset) =>
      `KyroxExchange.listAsset({{TestStock:${asset.symbol}}}, maxSourceAge=${asset.maxSourceAgeSeconds}, minPrice=${asset.minPriceUsdcPerWholeToken}, maxPrice=${asset.maxPriceUsdcPerWholeToken}); KyroxExchange.setPriceBounds({{TestStock:${asset.symbol}}}, ${asset.minPriceUsdcPerWholeToken}, ${asset.maxPriceUsdcPerWholeToken}, deviation=${asset.maxPriceDeviationBps}bps)`,
  );

  const gasEstimateFailures = { ...(input.gasEstimateFailures ?? {}) };
  const warnings: string[] = Object.entries(gasEstimateFailures).map(
    ([name, reason]) => `Gas estimate unavailable for ${name}: ${reason}`,
  );
  if (input.roles.priceUpdater.toLowerCase() === input.roles.admin.toLowerCase()) {
    warnings.push("Admin and price updater are the same key; separate keys are recommended.");
  }
  if (input.roles.pauser.toLowerCase() === input.roles.admin.toLowerCase()) {
    warnings.push("Admin and pauser are the same key; separate keys are recommended.");
  }

  const manifest: ProposedDeploymentManifest = {
    environment: "base-sepolia-proposal",
    status: "not_deployed",
    planningOnly: true,
    warning: PROPOSAL_WARNING,
    chainId: 84_532,
    createdAt: input.createdAt,
    roles: input.roles,
    compiler: steps[0]?.compiler ?? {
      compilerVersion: "unknown",
      optimizer: false,
      optimizerRuns: 0,
      evmVersion: "unknown",
    },
    contracts: steps.map((step) => ({
      name: step.contractName,
      address: null,
      bytecodeHash: step.bytecodeHash,
      constructorArgs: step.constructorArgs,
      dependencies: step.dependencies,
      estimatedGas: step.estimatedGas,
      ...(step.estimatedGasNote !== undefined ? { estimatedGasNote: step.estimatedGasNote } : {}),
      postDeployment: step.postDeployment,
    })),
    assets: input.assets.map((asset) => ({
      symbol: asset.symbol,
      name: asset.name,
      decimals: asset.decimals,
      stockToken: null,
      sourceChainId: asset.sourceChainId,
      feed: {
        address: asset.feedAddress,
        description: asset.feedDescription,
        verifiedAt: asset.verifiedAt,
      },
      freshness: { maxSourceAgeSeconds: asset.maxSourceAgeSeconds },
      priceBounds: {
        minPriceUsdcPerWholeToken: asset.minPriceUsdcPerWholeToken.toString(),
        maxPriceUsdcPerWholeToken: asset.maxPriceUsdcPerWholeToken.toString(),
        maxPriceDeviationBps: asset.maxPriceDeviationBps,
      },
    })),
  };

  return {
    chainId: 84_532,
    roles: input.roles,
    steps,
    roleGrants,
    assetConfiguration,
    gasEstimateFailures,
    warnings,
    manifest,
  };
}
