import type { Hex } from "viem";

/**
 * Base Sepolia chain identity.
 *
 * Genesis evidence:
 * - Base repository `base/base`, commit 76fa46dd3f64bb8806c749ddc510217696104a15
 *   (2026-11-20), file `crates/common/chains/res/genesis/sepolia_base.json`.
 * - Genesis timestamp 0x65135ee0 (1695768288), chainId 84532, 2,322 alloc entries.
 *
 * Genesis hash observed on 2026-11-21 from Tenderly, dRPC and the official
 * explorer (sepolia-explorer.base.org, redirecting to base-sepolia.blockscout.com).
 * The pinned checkpoint was confirmed by Tenderly, OnFinality, dRPC,
 * publicnode and the explorer. Public RPCs that prune block zero (including
 * sepolia.base.org and publicnode) cannot satisfy this guard and are rejected.
 *
 * A hash must never be changed from an RPC response without repeating that
 * cross-check and recording the evidence.
 */
export const BASE_SEPOLIA_GENESIS_HASH: Hex =
  "0x0dcc9e089e30b90ddfc55be9a37dd15bc551aeee999d2e2b51414c54eaf934e4";

export const BASE_SEPOLIA_CHECKPOINT_BLOCK = 61_800_000n;
export const BASE_SEPOLIA_CHECKPOINT_HASH: Hex =
  "0x486d04900ac2e7f6de0d2960cf1aae9095a2a60756e2dcddeac9aca33e26d7ce";

export const BASE_SEPOLIA_IDENTITY_SOURCES = {
  repository: "https://github.com/base/base",
  commit: "76fa46dd3f64bb8806c749ddc510217696104a15",
  genesisFile: "crates/common/chains/res/genesis/sepolia_base.json",
  genesisTimestamp: 1_695_768_288,
  checkedAt: "2026-11-21",
  providers: ["https://base-sepolia.drpc.org", "https://base-sepolia.gateway.tenderly.co"],
  explorer: "https://sepolia-explorer.base.org",
} as const;

export interface ChainIdentityProvider {
  /** An operator-assigned name used for independence checks and reporting. */
  readonly name: string;
  readonly rpc: {
    getChainId(): Promise<number>;
    getBlockHash(blockNumber: bigint): Promise<Hex>;
  };
}

export interface ChainIdentityEvidence {
  readonly chainId: 84_532;
  readonly genesisHash: Hex;
  readonly checkpointBlock: bigint;
  readonly checkpointHash: Hex;
  readonly providers: readonly string[];
}

export class ChainIdentityError extends Error {
  override readonly name = "ChainIdentityError";

  constructor(
    readonly code:
      | "MISSING_PROVIDERS"
      | "DUPLICATE_PROVIDER"
      | "WRONG_CHAIN"
      | "WRONG_GENESIS"
      | "WRONG_CHECKPOINT"
      | "PROVIDER_UNAVAILABLE"
      | "PROVIDER_DISAGREEMENT",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Require multiple independent providers to agree on chain id, genesis hash and
 * a pinned checkpoint. Any mismatch or unavailable provider fails closed.
 *
 * Provider "independence" is declared by the operator; two URLs from the same
 * infrastructure provider do not satisfy this check merely because both respond.
 */
export async function verifyChainIdentity(
  providers: readonly ChainIdentityProvider[],
  expected: {
    readonly chainId?: number;
    readonly genesisHash?: Hex;
    readonly checkpointBlock?: bigint;
    readonly checkpointHash?: Hex;
  } = {},
): Promise<ChainIdentityEvidence> {
  const chainId = expected.chainId ?? 84_532;
  const genesisHash = expected.genesisHash ?? BASE_SEPOLIA_GENESIS_HASH;
  const checkpointBlock = expected.checkpointBlock ?? BASE_SEPOLIA_CHECKPOINT_BLOCK;
  const checkpointHash = expected.checkpointHash ?? BASE_SEPOLIA_CHECKPOINT_HASH;

  if (providers.length < 2) {
    throw new ChainIdentityError(
      "MISSING_PROVIDERS",
      "At least two independent RPC providers are required for chain identity.",
    );
  }
  const names = new Set(providers.map((provider) => provider.name));
  if (names.size !== providers.length) {
    throw new ChainIdentityError(
      "DUPLICATE_PROVIDER",
      "Provider names must be unique; duplicate names are not independent evidence.",
    );
  }

  const results: Array<{ name: string; genesis: Hex; checkpoint: Hex }> = [];

  for (const provider of providers) {
    try {
      const observedChain = await provider.rpc.getChainId();
      if (observedChain !== chainId) {
        throw new ChainIdentityError(
          "WRONG_CHAIN",
          `${provider.name} reports chain ${observedChain}, expected ${chainId}.`,
        );
      }
      const genesis = await provider.rpc.getBlockHash(0n);
      if (genesis.toLowerCase() !== genesisHash.toLowerCase()) {
        throw new ChainIdentityError(
          "WRONG_GENESIS",
          `${provider.name} genesis ${genesis} does not match the pinned Base Sepolia genesis.`,
        );
      }
      const checkpoint = await provider.rpc.getBlockHash(checkpointBlock);
      if (checkpoint.toLowerCase() !== checkpointHash.toLowerCase()) {
        throw new ChainIdentityError(
          "WRONG_CHECKPOINT",
          `${provider.name} checkpoint ${checkpointBlock} hash ${checkpoint} does not match the approved checkpoint.`,
        );
      }
      results.push({ name: provider.name, genesis, checkpoint });
    } catch (error) {
      if (error instanceof ChainIdentityError) throw error;
      throw new ChainIdentityError(
        "PROVIDER_UNAVAILABLE",
        `${provider.name} could not provide identity evidence: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const first = results[0] as { genesis: Hex; checkpoint: Hex };
  for (const result of results.slice(1)) {
    if (
      result.genesis.toLowerCase() !== first.genesis.toLowerCase() ||
      result.checkpoint.toLowerCase() !== first.checkpoint.toLowerCase()
    ) {
      throw new ChainIdentityError(
        "PROVIDER_DISAGREEMENT",
        "RPC providers disagree on genesis or checkpoint evidence.",
      );
    }
  }

  return {
    chainId: 84_532,
    genesisHash,
    checkpointBlock,
    checkpointHash,
    providers: results.map((result) => result.name),
  };
}

/** Compare previously recorded evidence against the pinned constants. */
export function assertChainIdentityEvidence(evidence: ChainIdentityEvidence): void {
  if (evidence.chainId !== 84_532) {
    throw new ChainIdentityError("WRONG_CHAIN", "Recorded evidence is not Base Sepolia.");
  }
  if (evidence.genesisHash.toLowerCase() !== BASE_SEPOLIA_GENESIS_HASH.toLowerCase()) {
    throw new ChainIdentityError("WRONG_GENESIS", "Recorded genesis hash is not approved.");
  }
  if (
    evidence.checkpointBlock !== BASE_SEPOLIA_CHECKPOINT_BLOCK ||
    evidence.checkpointHash.toLowerCase() !== BASE_SEPOLIA_CHECKPOINT_HASH.toLowerCase()
  ) {
    throw new ChainIdentityError("WRONG_CHECKPOINT", "Recorded checkpoint is not approved.");
  }
  if (evidence.providers.length < 2) {
    throw new ChainIdentityError("MISSING_PROVIDERS", "Evidence lacks independent providers.");
  }
}
