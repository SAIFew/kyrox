import { describe, expect, it, vi } from "vitest";

import {
  BASE_SEQUENCER_DESCRIPTION,
  BASE_SEQUENCER_UPTIME_FEED,
  ChainlinkSequencerUptimeReader,
  SEQUENCER_GRACE_PERIOD_SECONDS,
  SequencerValidationError,
} from "../src/feeds/sequencer.js";
import type { EvmReadClient, LatestRoundData } from "../src/feeds/types.js";
import { SOURCE_CHAIN_ID } from "../src/feeds/types.js";

const NOW = 1_795_272_505;

const upRound: LatestRoundData = {
  roundId: 18_446_744_073_709_551_636n,
  answer: 0n,
  startedAt: BigInt(NOW - 2 * 86_400),
  updatedAt: BigInt(NOW - 3_601),
  answeredInRound: 18_446_744_073_709_551_636n,
};

function client(overrides: Partial<EvmReadClient> = {}): EvmReadClient {
  return {
    getChainId: vi.fn(async () => SOURCE_CHAIN_ID),
    getBytecode: vi.fn(async () => "0x6080604052"),
    readDecimals: vi.fn(async () => 0),
    readDescription: vi.fn(async () => BASE_SEQUENCER_DESCRIPTION),
    readLatestRoundData: vi.fn(async () => upRound),
    ...overrides,
  };
}

describe("ChainlinkSequencerUptimeReader", () => {
  it("reports healthy only after the grace period has elapsed", async () => {
    const reader = new ChainlinkSequencerUptimeReader(client(), () => NOW);
    const status = await reader.read();

    expect(status.feedAddress).toBe(BASE_SEQUENCER_UPTIME_FEED);
    expect(status.sourceChainId).toBe(8453);
    expect(status.answer).toBe(0);
    expect(status.gracePeriodSeconds).toBe(SEQUENCER_GRACE_PERIOD_SECONDS);
    expect(status.gracePeriodElapsed).toBe(true);
    expect(status.healthy).toBe(true);
    expect(status.sourceUpdatedAt).toBe(NOW - 3_601);
    expect(status.observedAt).toBe(NOW);
  });

  it("keeps the exact grace boundary closed", async () => {
    const reader = new ChainlinkSequencerUptimeReader(
      client({ readLatestRoundData: async () => ({ ...upRound, updatedAt: BigInt(NOW - 3_600) }) }),
      () => NOW,
    );
    const status = await reader.read();
    expect(status.gracePeriodElapsed).toBe(false);
    expect(status.healthy).toBe(false);
  });

  it("fails closed during the recovery grace period", async () => {
    const reader = new ChainlinkSequencerUptimeReader(client(), () => NOW);
    const status = await reader.read();
    expect(status.healthy).toBe(true);

    const recent = new ChainlinkSequencerUptimeReader(
      client({
        readLatestRoundData: async () => ({
          ...upRound,
          updatedAt: BigInt(NOW - 100),
        }),
      }),
      () => NOW,
    );
    const recentStatus = await recent.read();
    expect(recentStatus.answer).toBe(0);
    expect(recentStatus.gracePeriodElapsed).toBe(false);
    expect(recentStatus.healthy).toBe(false);
  });

  it("fails closed while the sequencer is down, even after the grace period", async () => {
    const reader = new ChainlinkSequencerUptimeReader(
      client({ readLatestRoundData: async () => ({ ...upRound, answer: 1n }) }),
      () => NOW,
    );
    const status = await reader.read();
    expect(status.answer).toBe(1);
    expect(status.gracePeriodElapsed).toBe(true);
    expect(status.healthy).toBe(false);
  });

  it("supports an explicit project grace period", async () => {
    const reader = new ChainlinkSequencerUptimeReader(
      client({ readLatestRoundData: async () => ({ ...upRound, updatedAt: BigInt(NOW - 100) }) }),
      () => NOW,
      60,
    );
    const status = await reader.read();
    expect(status.gracePeriodSeconds).toBe(60);
    expect(status.healthy).toBe(true);
  });

  it("rejects an unexpected answer", async () => {
    const reader = new ChainlinkSequencerUptimeReader(
      client({ readLatestRoundData: async () => ({ ...upRound, answer: 2n }) }),
      () => NOW,
    );
    await expect(reader.read()).rejects.toMatchObject({ code: "INVALID_ANSWER" });
  });

  it("rejects zero and future timestamps", async () => {
    const zero = new ChainlinkSequencerUptimeReader(
      client({ readLatestRoundData: async () => ({ ...upRound, updatedAt: 0n }) }),
      () => NOW,
    );
    await expect(zero.read()).rejects.toMatchObject({ code: "INVALID_TIMESTAMP" });

    const future = new ChainlinkSequencerUptimeReader(
      client({ readLatestRoundData: async () => ({ ...upRound, updatedAt: BigInt(NOW + 1) }) }),
      () => NOW,
    );
    await expect(future.read()).rejects.toMatchObject({ code: "FUTURE_TIMESTAMP" });
  });

  it("rejects a missing contract", async () => {
    for (const bytecode of ["0x", undefined]) {
      const reader = new ChainlinkSequencerUptimeReader(
        client({ getBytecode: async () => bytecode }),
        () => NOW,
      );
      await expect(reader.read()).rejects.toMatchObject({ code: "MISSING_CONTRACT" });
    }
  });

  it("rejects a wrong chain", async () => {
    const reader = new ChainlinkSequencerUptimeReader(
      client({ getChainId: async () => 84_532 }),
      () => NOW,
    );
    await expect(reader.read()).rejects.toMatchObject({ code: "WRONG_SOURCE_CHAIN" });
  });

  it("rejects a wrong description and incomplete rounds", async () => {
    const wrongDescription = new ChainlinkSequencerUptimeReader(
      client({ readDescription: async () => "Something else" }),
      () => NOW,
    );
    await expect(wrongDescription.read()).rejects.toMatchObject({
      code: "DESCRIPTION_MISMATCH",
    });

    const incomplete = new ChainlinkSequencerUptimeReader(
      client({
        readLatestRoundData: async () => ({ ...upRound, answeredInRound: upRound.roundId - 1n }),
      }),
      () => NOW,
    );
    await expect(incomplete.read()).rejects.toMatchObject({ code: "INCOMPLETE_ROUND" });
  });

  it("propagates an unavailable RPC without claiming health", async () => {
    const rpcError = new Error("rpc unavailable");
    const reader = new ChainlinkSequencerUptimeReader(
      client({
        readLatestRoundData: async () => {
          throw rpcError;
        },
      }),
      () => NOW,
    );
    await expect(reader.read()).rejects.toBe(rpcError);
    try {
      await reader.read();
    } catch (error) {
      expect(error).not.toBeInstanceOf(SequencerValidationError);
    }
  });
});
