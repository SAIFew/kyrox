import type { Address } from "@kyrox/core";

export type ObservationStatus = "valid" | "invalid";

export interface ObservationInsert {
  readonly assetSymbol: string;
  readonly sourceChainId: number;
  readonly feedAddress: Address;
  readonly rawAnswer: bigint;
  readonly feedDecimals: number;
  readonly sourceRoundId: bigint;
  readonly sourceUpdatedAt: number;
  readonly observedAt: number;
  readonly referencePriceUsdcPerWholeToken: bigint | null;
  readonly sourceDescription: string;
  readonly status: ObservationStatus;
  readonly validationError?: string;
}

export type IngestionOutcome =
  | "published"
  | "duplicate"
  | "invalid"
  | "rpc_error"
  | "store_error"
  | "sequencer_blocked"
  | "sequencer_error";

export interface IngestionEvent {
  readonly assetSymbol: string;
  readonly observedAt: number;
  readonly outcome: IngestionOutcome;
  readonly sourceRoundId?: bigint;
  readonly message?: string;
}

export type PublicationStatus =
  | "prepared"
  | "submitted"
  | "included"
  | "confirmed"
  | "verified"
  | "failed"
  | "verification_failed"
  | "reorged";

export interface PublicationRecord {
  readonly assetSymbol: string;
  readonly sourceRoundId: bigint;
  readonly exchangeAddress: Address;
  readonly calldataHash: string;
  readonly preparedAt: number;
  readonly stockToken: Address;
  readonly referencePriceUsdcPerWholeToken: bigint;
  readonly sourceUpdatedAt: number;
  readonly sourceChainId: number;
  readonly feedAddress: Address;
  readonly simulated: boolean;
  readonly observedAt: number;
  readonly artifactHash: string;
  readonly artifactJson: string;
}

export interface StoredPublication extends PublicationRecord {
  readonly status: PublicationStatus;
  readonly transactionHash?: string;
  readonly blockNumber?: string;
  readonly blockHash?: string;
  readonly confirmations?: number;
  readonly includedAt?: number;
  readonly verifiedAt?: number;
  readonly failureReason?: string;
  readonly reorgDetected?: boolean;
  readonly invalidatedAt?: number;
  readonly lastVerifiedAt?: number;
}

export interface PublicationUpdate {
  readonly assetSymbol: string;
  readonly sourceRoundId: bigint;
  readonly status: PublicationStatus;
  readonly transactionHash?: string;
  readonly blockNumber?: string;
  readonly blockHash?: string;
  readonly confirmations?: number;
  readonly includedAt?: number;
  readonly verifiedAt?: number;
  readonly invalidatedAt?: number;
  readonly failureReason?: string;
}

export interface PublicationTransition {
  readonly assetSymbol: string;
  readonly sourceRoundId: bigint;
  readonly fromStatus: PublicationStatus;
  readonly toStatus: PublicationStatus;
  readonly reason?: string;
  readonly occurredAt: number;
}

export const ALLOWED_PUBLICATION_TRANSITIONS: Readonly<
  Record<PublicationStatus, readonly PublicationStatus[]>
> = {
  prepared: ["submitted", "included", "verified", "failed", "verification_failed"],
  submitted: ["included", "verified", "failed", "verification_failed"],
  included: ["confirmed", "verified", "failed", "verification_failed", "reorged"],
  confirmed: ["verified", "failed", "reorged"],
  verified: ["reorged"],
  reorged: ["verified"],
  failed: [],
  verification_failed: [],
};

export class PublicationTransitionError extends Error {
  override readonly name = "PublicationTransitionError";
}

export interface ObservationStore {
  insertObservation(record: ObservationInsert): Promise<"inserted" | "duplicate">;
  recordEvent(event: IngestionEvent): Promise<void>;
  latestValidObservation(assetSymbol: string): Promise<ObservationInsert | null>;
  isPublished(assetSymbol: string, sourceRoundId: bigint): Promise<boolean>;
  latestPublishedRoundId(assetSymbol: string): Promise<bigint | null>;
  recordPublication(record: PublicationRecord): Promise<"inserted" | "duplicate">;
  getPublication(assetSymbol: string, sourceRoundId: bigint): Promise<StoredPublication | null>;
  updatePublication(update: PublicationUpdate): Promise<void>;
  publicationTransitions(
    assetSymbol: string,
    sourceRoundId: bigint,
  ): Promise<PublicationTransition[]>;
}

/** In-memory store used by tests and dry runs. Never used in production. */
export class InMemoryObservationStore implements ObservationStore {
  readonly observations: ObservationInsert[] = [];
  readonly events: IngestionEvent[] = [];
  readonly publications: StoredPublication[] = [];
  readonly transitions: PublicationTransition[] = [];

  async insertObservation(record: ObservationInsert): Promise<"inserted" | "duplicate"> {
    const exists = this.observations.some(
      (existing) =>
        existing.sourceChainId === record.sourceChainId &&
        existing.feedAddress === record.feedAddress &&
        existing.sourceRoundId === record.sourceRoundId,
    );
    if (exists) return "duplicate";
    this.observations.push(record);
    return "inserted";
  }

  async recordEvent(event: IngestionEvent): Promise<void> {
    this.events.push(event);
  }

  async latestValidObservation(assetSymbol: string): Promise<ObservationInsert | null> {
    const valid = this.observations.filter(
      (record) => record.assetSymbol === assetSymbol && record.status === "valid",
    );
    return valid.length > 0 ? (valid[valid.length - 1] as ObservationInsert) : null;
  }

  async isPublished(assetSymbol: string, sourceRoundId: bigint): Promise<boolean> {
    return this.publications.some(
      (publication) =>
        publication.assetSymbol === assetSymbol && publication.sourceRoundId === sourceRoundId,
    );
  }

  async latestPublishedRoundId(assetSymbol: string): Promise<bigint | null> {
    const rounds = this.publications
      .filter((publication) => publication.assetSymbol === assetSymbol)
      .map((publication) => publication.sourceRoundId);
    if (rounds.length === 0) return null;
    return rounds.reduce((highest, round) => (round > highest ? round : highest), 0n);
  }

  async recordPublication(record: PublicationRecord): Promise<"inserted" | "duplicate"> {
    if (await this.isPublished(record.assetSymbol, record.sourceRoundId)) return "duplicate";
    this.publications.push({ ...record, status: "prepared", reorgDetected: false });
    return "inserted";
  }

  async getPublication(
    assetSymbol: string,
    sourceRoundId: bigint,
  ): Promise<StoredPublication | null> {
    return (
      this.publications.find(
        (publication) =>
          publication.assetSymbol === assetSymbol && publication.sourceRoundId === sourceRoundId,
      ) ?? null
    );
  }

  async updatePublication(update: PublicationUpdate): Promise<void> {
    const index = this.publications.findIndex(
      (publication) =>
        publication.assetSymbol === update.assetSymbol &&
        publication.sourceRoundId === update.sourceRoundId,
    );
    if (index < 0) throw new Error("Publication record not found.");
    const current = this.publications[index] as StoredPublication;
    if (current.status === update.status) return;

    if (!ALLOWED_PUBLICATION_TRANSITIONS[current.status].includes(update.status)) {
      throw new PublicationTransitionError(
        `Illegal publication transition ${current.status} -> ${update.status}.`,
      );
    }
    if (
      update.transactionHash !== undefined &&
      this.publications.some(
        (publication, otherIndex) =>
          otherIndex !== index && publication.transactionHash === update.transactionHash,
      )
    ) {
      throw new Error("Transaction hash is already associated with another publication.");
    }

    this.publications[index] = {
      ...current,
      status: update.status,
      ...(update.transactionHash !== undefined ? { transactionHash: update.transactionHash } : {}),
      ...(update.blockNumber !== undefined ? { blockNumber: update.blockNumber } : {}),
      ...(update.blockHash !== undefined ? { blockHash: update.blockHash } : {}),
      ...(update.confirmations !== undefined ? { confirmations: update.confirmations } : {}),
      ...(update.includedAt !== undefined ? { includedAt: update.includedAt } : {}),
      ...(update.verifiedAt !== undefined ? { verifiedAt: update.verifiedAt } : {}),
      ...(update.failureReason !== undefined ? { failureReason: update.failureReason } : {}),
      ...(update.status === "verified"
        ? { lastVerifiedAt: update.verifiedAt ?? current.lastVerifiedAt }
        : {}),
      ...(update.status === "reorged"
        ? { reorgDetected: true, invalidatedAt: update.invalidatedAt ?? update.includedAt }
        : {}),
    };
    this.transitions.push({
      assetSymbol: update.assetSymbol,
      sourceRoundId: update.sourceRoundId,
      fromStatus: current.status,
      toStatus: update.status,
      ...(update.transactionHash !== undefined ? { transactionHash: update.transactionHash } : {}),
      ...(update.failureReason !== undefined ? { reason: update.failureReason } : {}),
      occurredAt: Math.floor(Date.now() / 1000),
    });
  }

  async publicationTransitions(
    assetSymbol: string,
    sourceRoundId: bigint,
  ): Promise<PublicationTransition[]> {
    return this.transitions.filter(
      (transition) =>
        transition.assetSymbol === assetSymbol && transition.sourceRoundId === sourceRoundId,
    );
  }
}
