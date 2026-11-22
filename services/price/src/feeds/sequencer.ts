import type { Address } from "@kyrox/core";

import type { EvmReadClient } from "./types.js";
import { SOURCE_CHAIN_ID } from "./types.js";

/**
 * Chainlink L2 Sequencer Uptime Feed for Base Mainnet.
 *
 * Source: https://docs.chain.link/data-feeds/l2-sequencer-feeds
 * Verified live 2026-11-21: code present, description
 * "L2 Sequencer Uptime Status Feed", decimals 0, answer 0 (up).
 */
export const BASE_SEQUENCER_UPTIME_FEED: Address = "0xBCF85224fc0756B9Fa45aA7892530B47e10b6433";

export const BASE_SEQUENCER_DESCRIPTION = "L2 Sequencer Uptime Status Feed";

/** Recovery window after the sequencer comes back up. */
export const SEQUENCER_GRACE_PERIOD_SECONDS = 3_600;

export type SequencerErrorCode =
  | "WRONG_SOURCE_CHAIN"
  | "MISSING_CONTRACT"
  | "DESCRIPTION_MISMATCH"
  | "INVALID_ROUND"
  | "INCOMPLETE_ROUND"
  | "INVALID_ANSWER"
  | "INVALID_TIMESTAMP"
  | "FUTURE_TIMESTAMP";

export class SequencerValidationError extends Error {
  override readonly name = "SequencerValidationError";

  constructor(
    readonly code: SequencerErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface SequencerStatus {
  readonly feedAddress: Address;
  readonly sourceChainId: typeof SOURCE_CHAIN_ID;
  /** 0 = up, 1 = down, as reported by the feed. */
  readonly answer: 0 | 1;
  readonly roundId: bigint;
  readonly sourceUpdatedAt: number;
  readonly observedAt: number;
  readonly gracePeriodSeconds: number;
  /** True only when up AND the recovery grace period has elapsed. */
  readonly healthy: boolean;
  readonly gracePeriodElapsed: boolean;
}

export interface SequencerUptimeReader {
  read(): Promise<SequencerStatus>;
}

export class ChainlinkSequencerUptimeReader implements SequencerUptimeReader {
  readonly #client: EvmReadClient;
  readonly #nowSeconds: () => number;
  readonly #gracePeriodSeconds: number;

  constructor(
    client: EvmReadClient,
    nowSeconds: () => number = () => Math.floor(Date.now() / 1000),
    gracePeriodSeconds: number = SEQUENCER_GRACE_PERIOD_SECONDS,
  ) {
    if (!Number.isInteger(gracePeriodSeconds) || gracePeriodSeconds < 0) {
      throw new Error("Sequencer grace period must be a non-negative integer.");
    }
    this.#client = client;
    this.#nowSeconds = nowSeconds;
    this.#gracePeriodSeconds = gracePeriodSeconds;
  }

  async read(): Promise<SequencerStatus> {
    const chainId = await this.#client.getChainId();
    if (chainId !== SOURCE_CHAIN_ID) {
      throw new SequencerValidationError(
        "WRONG_SOURCE_CHAIN",
        `Sequencer feed must be read from ${SOURCE_CHAIN_ID}, got ${chainId}.`,
      );
    }

    const bytecode = await this.#client.getBytecode(BASE_SEQUENCER_UPTIME_FEED);
    if (bytecode === undefined || bytecode === "0x") {
      throw new SequencerValidationError(
        "MISSING_CONTRACT",
        `No contract code at sequencer feed ${BASE_SEQUENCER_UPTIME_FEED}.`,
      );
    }

    const description = await this.#client.readDescription(BASE_SEQUENCER_UPTIME_FEED);
    if (description !== BASE_SEQUENCER_DESCRIPTION) {
      throw new SequencerValidationError(
        "DESCRIPTION_MISMATCH",
        `Sequencer feed describes itself as "${description}".`,
      );
    }

    const round = await this.#client.readLatestRoundData(BASE_SEQUENCER_UPTIME_FEED);
    const nowSeconds = this.#nowSeconds();

    if (round.roundId <= 0n) {
      throw new SequencerValidationError("INVALID_ROUND", "Sequencer round id must be positive.");
    }
    if (round.answeredInRound < round.roundId) {
      throw new SequencerValidationError(
        "INCOMPLETE_ROUND",
        `Sequencer round ${round.roundId} was answered in ${round.answeredInRound}.`,
      );
    }
    if (round.answer !== 0n && round.answer !== 1n) {
      throw new SequencerValidationError(
        "INVALID_ANSWER",
        `Unexpected sequencer answer ${round.answer}; expected 0 (up) or 1 (down).`,
      );
    }
    if (round.updatedAt <= 0n || round.startedAt <= 0n) {
      throw new SequencerValidationError(
        "INVALID_TIMESTAMP",
        "Sequencer timestamps must be positive.",
      );
    }
    if (round.updatedAt > BigInt(nowSeconds)) {
      throw new SequencerValidationError(
        "FUTURE_TIMESTAMP",
        `Sequencer updatedAt ${round.updatedAt} is later than now ${nowSeconds}.`,
      );
    }
    if (round.updatedAt > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new SequencerValidationError(
        "INVALID_TIMESTAMP",
        "Sequencer timestamp exceeds the safe integer range.",
      );
    }

    const answer = round.answer === 0n ? 0 : 1;
    const sourceUpdatedAt = Number(round.updatedAt);
    const gracePeriodElapsed = nowSeconds - sourceUpdatedAt >= this.#gracePeriodSeconds;

    // A successful RPC call is not proof of health: the feed must report up AND
    // the recovery window must have elapsed.
    return {
      feedAddress: BASE_SEQUENCER_UPTIME_FEED,
      sourceChainId: SOURCE_CHAIN_ID,
      answer,
      roundId: round.roundId,
      sourceUpdatedAt,
      observedAt: nowSeconds,
      gracePeriodSeconds: this.#gracePeriodSeconds,
      gracePeriodElapsed,
      healthy: answer === 0 && gracePeriodElapsed,
    };
  }
}

export function describeSequencerStatus(status: SequencerStatus): string {
  return [
    `sequencer=${status.answer === 0 ? "up" : "down"}`,
    `round=${status.roundId.toString()}`,
    `updatedAt=${status.sourceUpdatedAt}`,
    `graceElapsed=${String(status.gracePeriodElapsed)}`,
  ].join(" ");
}
