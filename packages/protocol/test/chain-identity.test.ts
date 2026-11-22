import { describe, expect, it } from "vitest";
import type { Hex } from "viem";

import {
  BASE_SEPOLIA_CHECKPOINT_BLOCK,
  BASE_SEPOLIA_CHECKPOINT_HASH,
  BASE_SEPOLIA_GENESIS_HASH,
  ChainIdentityError,
  assertChainIdentityEvidence,
  verifyChainIdentity,
  type ChainIdentityProvider,
} from "../src/index.js";

const GOOD_GENESIS = BASE_SEPOLIA_GENESIS_HASH;
const GOOD_CHECKPOINT = BASE_SEPOLIA_CHECKPOINT_HASH;

function provider(
  name: string,
  values: Partial<{ chainId: number; genesis: Hex; checkpoint: Hex }> = {},
): ChainIdentityProvider {
  return {
    name,
    rpc: {
      getChainId: async () => values.chainId ?? 84_532,
      getBlockHash: async (blockNumber) => {
        if (blockNumber === 0n) return values.genesis ?? GOOD_GENESIS;
        if (blockNumber === BASE_SEPOLIA_CHECKPOINT_BLOCK) {
          return values.checkpoint ?? GOOD_CHECKPOINT;
        }
        throw new Error("unexpected block");
      },
    },
  };
}

describe("Base Sepolia chain identity", () => {
  it("accepts two agreeing independent providers", async () => {
    const evidence = await verifyChainIdentity([provider("a"), provider("b")]);
    expect(evidence.chainId).toBe(84_532);
    expect(evidence.genesisHash).toBe(GOOD_GENESIS);
    expect(evidence.checkpointHash).toBe(GOOD_CHECKPOINT);
    expect(evidence.providers).toEqual(["a", "b"]);
    expect(() => assertChainIdentityEvidence(evidence)).not.toThrow();
  });

  it("rejects a local 84532 chain whose genesis differs", async () => {
    await expect(
      verifyChainIdentity([provider("a"), provider("b", { genesis: `0x${"11".repeat(32)}` })]),
    ).rejects.toMatchObject({ code: "WRONG_GENESIS" });
  });

  it("rejects a wrong genesis on every provider", async () => {
    await expect(
      verifyChainIdentity([
        provider("a", { genesis: `0x${"11".repeat(32)}` }),
        provider("b", { genesis: `0x${"11".repeat(32)}` }),
      ]),
    ).rejects.toMatchObject({ code: "WRONG_GENESIS" });
  });

  it("rejects a wrong checkpoint", async () => {
    await expect(
      verifyChainIdentity([provider("a"), provider("b", { checkpoint: `0x${"22".repeat(32)}` })]),
    ).rejects.toMatchObject({ code: "WRONG_CHECKPOINT" });
  });

  it("rejects conflicting providers even if both otherwise look valid", async () => {
    await expect(
      verifyChainIdentity([provider("a"), provider("b", { genesis: `0x${"11".repeat(32)}` })]),
    ).rejects.toBeInstanceOf(ChainIdentityError);
  });

  it("rejects a missing secondary provider or duplicate names", async () => {
    await expect(verifyChainIdentity([provider("a")])).rejects.toMatchObject({
      code: "MISSING_PROVIDERS",
    });
    await expect(verifyChainIdentity([provider("a"), provider("a")])).rejects.toMatchObject({
      code: "DUPLICATE_PROVIDER",
    });
  });

  it("fails closed when a provider is unavailable or on the wrong chain", async () => {
    const unavailable: ChainIdentityProvider = {
      name: "down",
      rpc: {
        getChainId: async () => {
          throw new Error("connection refused");
        },
        getBlockHash: async () => GOOD_GENESIS,
      },
    };
    await expect(verifyChainIdentity([provider("a"), unavailable])).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
    await expect(
      verifyChainIdentity([provider("a"), provider("b", { chainId: 8_453 })]),
    ).rejects.toMatchObject({ code: "WRONG_CHAIN" });
  });

  it("rejects tampered recorded evidence", async () => {
    const evidence = await verifyChainIdentity([provider("a"), provider("b")]);
    expect(() =>
      assertChainIdentityEvidence({ ...evidence, genesisHash: `0x${"33".repeat(32)}` }),
    ).toThrow(ChainIdentityError);
    expect(() => assertChainIdentityEvidence({ ...evidence, providers: ["a"] })).toThrow(
      ChainIdentityError,
    );
  });
});
