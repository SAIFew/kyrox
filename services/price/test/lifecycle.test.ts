import { describe, expect, it } from "vitest";

import {
  InMemoryObservationStore,
  PublicationTransitionError,
  type PublicationRecord,
} from "../src/persistence/types.js";

const record: PublicationRecord = {
  assetSymbol: "tAAPL",
  sourceRoundId: 1n,
  exchangeAddress: "0x1111111111111111111111111111111111111111",
  calldataHash: `0x${"aa".repeat(32)}`,
  preparedAt: 1_795_000_000,
  stockToken: "0x2222222222222222222222222222222222222222",
  referencePriceUsdcPerWholeToken: 230_000_000n,
  sourceUpdatedAt: 1_794_999_000,
  sourceChainId: 8_453,
  feedAddress: "0x0000000000000000000000000000000000000000",
  simulated: true,
  observedAt: 1_795_000_000,
  artifactHash: "",
  artifactJson: "",
};

describe("publication state machine", () => {
  it("allows monotonic transitions and records history", async () => {
    const store = new InMemoryObservationStore();
    await store.recordPublication(record);
    await store.updatePublication({
      assetSymbol: "tAAPL",
      sourceRoundId: 1n,
      status: "included",
      transactionHash: `0x${"bb".repeat(32)}`,
      blockNumber: "100",
      blockHash: `0x${"cc".repeat(32)}`,
      confirmations: 1,
    });
    await store.updatePublication({
      assetSymbol: "tAAPL",
      sourceRoundId: 1n,
      status: "verified",
      transactionHash: `0x${"bb".repeat(32)}`,
      confirmations: 4,
      verifiedAt: 1_795_000_100,
    });
    expect((await store.getPublication("tAAPL", 1n))?.status).toBe("verified");
    expect((await store.publicationTransitions("tAAPL", 1n)).map((t) => t.toStatus)).toEqual([
      "included",
      "verified",
    ]);
  });

  it("rejects a downgrade from verified and keeps history intact", async () => {
    const store = new InMemoryObservationStore();
    await store.recordPublication(record);
    await store.updatePublication({
      assetSymbol: "tAAPL",
      sourceRoundId: 1n,
      status: "verified",
      transactionHash: `0x${"bb".repeat(32)}`,
      verifiedAt: 1_795_000_100,
    });
    await expect(
      store.updatePublication({ assetSymbol: "tAAPL", sourceRoundId: 1n, status: "included" }),
    ).rejects.toBeInstanceOf(PublicationTransitionError);
    expect((await store.getPublication("tAAPL", 1n))?.status).toBe("verified");
  });

  it("moves a verified publication to reorged instead of silently staying verified", async () => {
    const store = new InMemoryObservationStore();
    await store.recordPublication(record);
    await store.updatePublication({
      assetSymbol: "tAAPL",
      sourceRoundId: 1n,
      status: "verified",
      transactionHash: `0x${"bb".repeat(32)}`,
      verifiedAt: 1_795_000_100,
    });
    await store.updatePublication({
      assetSymbol: "tAAPL",
      sourceRoundId: 1n,
      status: "reorged",
      failureReason: "block hash changed",
      invalidatedAt: 1_795_000_200,
    });
    const stored = await store.getPublication("tAAPL", 1n);
    expect(stored?.status).toBe("reorged");
    expect(stored?.reorgDetected).toBe(true);
    expect(stored?.verifiedAt).toBe(1_795_000_100);
    expect((await store.publicationTransitions("tAAPL", 1n)).map((t) => t.toStatus)).toEqual([
      "verified",
      "reorged",
    ]);
  });

  it("allows a reorg from included as well as verified", async () => {
    const store = new InMemoryObservationStore();
    await store.recordPublication(record);
    await store.updatePublication({
      assetSymbol: "tAAPL",
      sourceRoundId: 1n,
      status: "included",
      transactionHash: `0x${"bb".repeat(32)}`,
      blockHash: `0x${"cc".repeat(32)}`,
      confirmations: 1,
    });
    await store.updatePublication({
      assetSymbol: "tAAPL",
      sourceRoundId: 1n,
      status: "reorged",
      failureReason: "block hash changed",
      invalidatedAt: 1_795_000_200,
    });
    expect((await store.getPublication("tAAPL", 1n))?.status).toBe("reorged");
  });

  it("is idempotent when the requested status is already current", async () => {
    const store = new InMemoryObservationStore();
    await store.recordPublication(record);
    await store.updatePublication({
      assetSymbol: "tAAPL",
      sourceRoundId: 1n,
      status: "verified",
      transactionHash: `0x${"bb".repeat(32)}`,
      verifiedAt: 1_795_000_100,
    });
    await store.updatePublication({ assetSymbol: "tAAPL", sourceRoundId: 1n, status: "verified" });
    expect(await store.publicationTransitions("tAAPL", 1n)).toHaveLength(1);
  });
});
