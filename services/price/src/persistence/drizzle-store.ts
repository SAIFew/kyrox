import { and, desc, eq, sql } from "drizzle-orm";

import {
  priceIngestionEvents,
  priceObservations,
  pricePublicationTransitions,
  pricePublications,
  type Database,
} from "@kyrox/db";

import {
  ALLOWED_PUBLICATION_TRANSITIONS,
  PublicationTransitionError,
  type IngestionEvent,
  type ObservationInsert,
  type ObservationStore,
  type PublicationRecord,
  type PublicationTransition,
  type PublicationUpdate,
  type StoredPublication,
} from "./types.js";

function toDate(seconds: number): Date {
  return new Date(seconds * 1000);
}

/**
 * PostgreSQL implementation of the observation store.
 *
 * Unique indexes on `(sourceChainId, feedAddress, sourceRoundId)` and
 * `(assetSymbol, sourceRoundId)` make duplicate writes idempotent regardless of
 * how often the worker restarts.
 */
export class DrizzleObservationStore implements ObservationStore {
  readonly #db: Database["db"];

  constructor(db: Database["db"]) {
    this.#db = db;
  }

  async insertObservation(record: ObservationInsert): Promise<"inserted" | "duplicate"> {
    const inserted = await this.#db
      .insert(priceObservations)
      .values({
        assetSymbol: record.assetSymbol,
        sourceChainId: record.sourceChainId,
        feedAddress: record.feedAddress,
        rawAnswer: record.rawAnswer.toString(),
        feedDecimals: record.feedDecimals,
        sourceRoundId: record.sourceRoundId.toString(),
        sourceUpdatedAt: toDate(record.sourceUpdatedAt),
        observedAt: toDate(record.observedAt),
        referencePriceUsdcPerWholeToken: record.referencePriceUsdcPerWholeToken?.toString() ?? null,
        sourceDescription: record.sourceDescription,
        status: record.status,
        validationError: record.validationError ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: priceObservations.id });

    return inserted.length > 0 ? "inserted" : "duplicate";
  }

  async recordEvent(event: IngestionEvent): Promise<void> {
    await this.#db.insert(priceIngestionEvents).values({
      assetSymbol: event.assetSymbol,
      observedAt: toDate(event.observedAt),
      outcome: event.outcome,
      sourceRoundId: event.sourceRoundId?.toString() ?? null,
      message: event.message ?? null,
    });
  }

  async latestValidObservation(
    assetSymbol: string,
    expectedFeedAddress?: ObservationInsert["feedAddress"],
  ): Promise<ObservationInsert | null> {
    const rows = await this.#db
      .select()
      .from(priceObservations)
      .where(
        and(
          eq(priceObservations.assetSymbol, assetSymbol),
          eq(priceObservations.status, "valid"),
          expectedFeedAddress === undefined
            ? undefined
            : sql`lower(${priceObservations.feedAddress}) = lower(${expectedFeedAddress})`,
        ),
      )
      // Canonical source order, not ingestion arrival order. A delayed older
      // poll can never replace a newer source timestamp/round. `id` is the
      // deterministic final tie-breaker for otherwise identical rows.
      .orderBy(
        desc(priceObservations.sourceUpdatedAt),
        desc(priceObservations.sourceRoundId),
        desc(priceObservations.id),
      )
      .limit(1);

    const row = rows[0];
    if (row === undefined) return null;

    return {
      assetSymbol: row.assetSymbol,
      sourceChainId: row.sourceChainId,
      feedAddress: row.feedAddress as ObservationInsert["feedAddress"],
      rawAnswer: BigInt(row.rawAnswer),
      feedDecimals: row.feedDecimals,
      sourceRoundId: BigInt(row.sourceRoundId),
      sourceUpdatedAt: Math.floor(row.sourceUpdatedAt.getTime() / 1000),
      observedAt: Math.floor(row.observedAt.getTime() / 1000),
      referencePriceUsdcPerWholeToken:
        row.referencePriceUsdcPerWholeToken === null
          ? null
          : BigInt(row.referencePriceUsdcPerWholeToken),
      sourceDescription: row.sourceDescription,
      status: "valid",
    };
  }

  async isPublished(assetSymbol: string, sourceRoundId: bigint): Promise<boolean> {
    const rows = await this.#db
      .select({ id: pricePublications.id })
      .from(pricePublications)
      .where(
        and(
          eq(pricePublications.assetSymbol, assetSymbol),
          eq(pricePublications.sourceRoundId, sourceRoundId.toString()),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async latestPublishedRoundId(assetSymbol: string): Promise<bigint | null> {
    const rows = await this.#db
      .select({ round: pricePublications.sourceRoundId })
      .from(pricePublications)
      .where(eq(pricePublications.assetSymbol, assetSymbol))
      .orderBy(desc(pricePublications.sourceRoundId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : BigInt(row.round);
  }

  async recordPublication(record: PublicationRecord): Promise<"inserted" | "duplicate"> {
    const inserted = await this.#db
      .insert(pricePublications)
      .values({
        assetSymbol: record.assetSymbol,
        sourceRoundId: record.sourceRoundId.toString(),
        exchangeAddress: record.exchangeAddress,
        calldataHash: record.calldataHash,
        preparedAt: toDate(record.preparedAt),
        status: "prepared",
        stockToken: record.stockToken,
        referencePriceUsdcPerWholeToken: record.referencePriceUsdcPerWholeToken.toString(),
        sourceUpdatedAt: toDate(record.sourceUpdatedAt),
        sourceChainId: record.sourceChainId,
        feedAddress: record.feedAddress,
        simulated: record.simulated,
        observedAt: toDate(record.observedAt),
        artifactHash: record.artifactHash,
        artifactJson: record.artifactJson,
      })
      .onConflictDoNothing()
      .returning({ id: pricePublications.id });
    return inserted.length > 0 ? "inserted" : "duplicate";
  }

  async getPublication(
    assetSymbol: string,
    sourceRoundId: bigint,
  ): Promise<StoredPublication | null> {
    const rows = await this.#db
      .select()
      .from(pricePublications)
      .where(
        and(
          eq(pricePublications.assetSymbol, assetSymbol),
          eq(pricePublications.sourceRoundId, sourceRoundId.toString()),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    if (
      row.stockToken === null ||
      row.referencePriceUsdcPerWholeToken === null ||
      row.sourceUpdatedAt === null ||
      row.sourceChainId === null ||
      row.feedAddress === null ||
      row.simulated === null ||
      row.observedAt === null
    ) {
      throw new Error("Publication record is missing its immutable observation snapshot.");
    }

    return {
      assetSymbol: row.assetSymbol,
      sourceRoundId: BigInt(row.sourceRoundId),
      exchangeAddress: row.exchangeAddress as StoredPublication["exchangeAddress"],
      calldataHash: row.calldataHash,
      preparedAt: Math.floor(row.preparedAt.getTime() / 1000),
      stockToken: row.stockToken as StoredPublication["stockToken"],
      referencePriceUsdcPerWholeToken: BigInt(row.referencePriceUsdcPerWholeToken),
      sourceUpdatedAt: Math.floor(row.sourceUpdatedAt.getTime() / 1000),
      sourceChainId: row.sourceChainId,
      feedAddress: row.feedAddress as StoredPublication["feedAddress"],
      simulated: row.simulated,
      observedAt: Math.floor(row.observedAt.getTime() / 1000),
      artifactHash: row.artifactHash ?? "",
      artifactJson: row.artifactJson ?? "",
      status: row.status,
      ...(row.transactionHash !== null ? { transactionHash: row.transactionHash } : {}),
      ...(row.blockNumber !== null ? { blockNumber: row.blockNumber } : {}),
      ...(row.blockHash !== null ? { blockHash: row.blockHash } : {}),
      ...(row.confirmations !== null ? { confirmations: row.confirmations } : {}),
      ...(row.includedAt !== null
        ? { includedAt: Math.floor(row.includedAt.getTime() / 1000) }
        : {}),
      ...(row.verifiedAt !== null
        ? { verifiedAt: Math.floor(row.verifiedAt.getTime() / 1000) }
        : {}),
      ...(row.failureReason !== null ? { failureReason: row.failureReason } : {}),
      reorgDetected: row.reorgDetected,
      ...(row.invalidatedAt !== null
        ? { invalidatedAt: Math.floor(row.invalidatedAt.getTime() / 1000) }
        : {}),
      ...(row.lastVerifiedAt !== null
        ? { lastVerifiedAt: Math.floor(row.lastVerifiedAt.getTime() / 1000) }
        : {}),
    };
  }

  async updatePublication(update: PublicationUpdate): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.getPublication(update.assetSymbol, update.sourceRoundId);
      if (current === null) throw new Error("Publication record not found.");
      if (current.status === update.status) return;
      if (!ALLOWED_PUBLICATION_TRANSITIONS[current.status].includes(update.status)) {
        throw new PublicationTransitionError(
          `Illegal publication transition ${current.status} -> ${update.status}.`,
        );
      }

      const values: Record<string, unknown> = { status: update.status };
      if (update.transactionHash !== undefined) values.transactionHash = update.transactionHash;
      if (update.blockNumber !== undefined) values.blockNumber = update.blockNumber;
      if (update.blockHash !== undefined) values.blockHash = update.blockHash;
      if (update.confirmations !== undefined) values.confirmations = update.confirmations;
      if (update.includedAt !== undefined) values.includedAt = toDate(update.includedAt);
      if (update.verifiedAt !== undefined) values.verifiedAt = toDate(update.verifiedAt);
      if (update.failureReason !== undefined) values.failureReason = update.failureReason;
      if (update.status === "verified") {
        values.lastVerifiedAt = toDate(update.verifiedAt ?? update.includedAt ?? 0);
      }
      if (update.status === "reorged") {
        values.reorgDetected = true;
        values.invalidatedAt = toDate(update.invalidatedAt ?? update.includedAt ?? 0);
      }

      const written = await this.#db.transaction(async (tx) => {
        const rows = await tx
          .update(pricePublications)
          .set(values)
          .where(
            and(
              eq(pricePublications.assetSymbol, update.assetSymbol),
              eq(pricePublications.sourceRoundId, update.sourceRoundId.toString()),
              eq(pricePublications.status, current.status),
            ),
          )
          .returning({ id: pricePublications.id });
        if (rows.length === 0) return false;
        await tx.insert(pricePublicationTransitions).values({
          assetSymbol: update.assetSymbol,
          sourceRoundId: update.sourceRoundId.toString(),
          fromStatus: current.status,
          toStatus: update.status,
          transactionHash: update.transactionHash ?? null,
          reason: update.failureReason ?? null,
          occurredAt: toDate(Math.floor(Date.now() / 1000)),
        });
        return true;
      });
      if (written) return;
    }
    throw new PublicationTransitionError(
      "Publication state changed concurrently; retry verification.",
    );
  }

  async publicationTransitions(
    assetSymbol: string,
    sourceRoundId: bigint,
  ): Promise<PublicationTransition[]> {
    const rows = await this.#db
      .select()
      .from(pricePublicationTransitions)
      .where(
        and(
          eq(pricePublicationTransitions.assetSymbol, assetSymbol),
          eq(pricePublicationTransitions.sourceRoundId, sourceRoundId.toString()),
        ),
      )
      .orderBy(pricePublicationTransitions.occurredAt);
    return rows.map((row) => ({
      assetSymbol: row.assetSymbol,
      sourceRoundId: BigInt(row.sourceRoundId),
      fromStatus: row.fromStatus as PublicationTransition["fromStatus"],
      toStatus: row.toStatus as PublicationTransition["toStatus"],
      ...(row.transactionHash !== null ? { transactionHash: row.transactionHash } : {}),
      ...(row.reason !== null ? { reason: row.reason } : {}),
      occurredAt: Math.floor(row.occurredAt.getTime() / 1000),
    }));
  }
}
