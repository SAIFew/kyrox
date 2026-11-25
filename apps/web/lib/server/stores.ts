import { and, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";

import { authNonces, authSessions, issuedQuotes, tradeIntents, type Database } from "@kyrox/db";
import type { Address } from "@kyrox/core";
import type { IssuedQuoteRecord } from "@kyrox/trade-intent";

import type { AuthStore, NonceRecord, SessionRecord } from "./auth.js";

type Db = Database["db"];

const nowDate = () => new Date();

export class DrizzleAuthStore implements AuthStore {
  constructor(readonly db: Db) {}

  async createNonce(address: string | null, issuedAt: Date, expiresAt: Date, nonce: string) {
    await this.db.insert(authNonces).values({ address, issuedAt, expiresAt, nonce });
  }

  async getNonce(nonce: string): Promise<NonceRecord | null> {
    const row = (
      await this.db.select().from(authNonces).where(eq(authNonces.nonce, nonce)).limit(1)
    )[0];
    if (row === undefined) return null;
    return {
      nonce: row.nonce,
      address: row.address,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
    };
  }

  async consumeNonce(nonce: string, now: Date): Promise<boolean> {
    const rows = await this.db
      .update(authNonces)
      .set({ usedAt: now })
      .where(
        and(eq(authNonces.nonce, nonce), isNull(authNonces.usedAt), gte(authNonces.expiresAt, now)),
      )
      .returning({ nonce: authNonces.nonce });
    return rows.length === 1;
  }

  async createSession(record: SessionRecord) {
    await this.db.insert(authSessions).values(record);
  }

  async getSession(tokenHash: string): Promise<SessionRecord | null> {
    const row = (
      await this.db
        .select()
        .from(authSessions)
        .where(eq(authSessions.tokenHash, tokenHash))
        .limit(1)
    )[0];
    if (row === undefined) return null;
    await this.db
      .update(authSessions)
      .set({ lastSeenAt: nowDate() })
      .where(eq(authSessions.tokenHash, tokenHash));
    return row;
  }

  async deleteSession(tokenHash: string) {
    await this.db.delete(authSessions).where(eq(authSessions.tokenHash, tokenHash));
  }
}

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    typeof v === "bigint" ? { __bigint: v.toString() } : v,
  );
}

function parse<T>(value: string): T {
  return JSON.parse(value, (_key, v) => {
    if (
      v !== null &&
      typeof v === "object" &&
      "__bigint" in v &&
      typeof (v as { __bigint: unknown }).__bigint === "string"
    ) {
      return BigInt((v as { __bigint: string }).__bigint);
    }
    return v;
  }) as T;
}

export class DrizzleQuoteStore {
  constructor(readonly db: Db) {}

  async save(record: IssuedQuoteRecord): Promise<void> {
    await this.db.insert(issuedQuotes).values({
      id: record.id,
      trader: record.trader,
      assetSymbol: record.assetSymbol,
      quoteJson: serialize(record.quote),
      observationJson: serialize(record.observation),
      freshnessJson: serialize(record.freshness),
      boundsJson: serialize(record.priceBounds),
      marketSession: record.session,
      maxSlippageBps: record.maxSlippageBps,
      issuedAt: new Date(record.issuedAt * 1000),
      expiresAt: new Date(record.expiresAt * 1000),
      used: record.used,
    });
  }

  async get(id: string): Promise<IssuedQuoteRecord | null> {
    const row = (
      await this.db.select().from(issuedQuotes).where(eq(issuedQuotes.id, id)).limit(1)
    )[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      trader: row.trader as Address,
      assetSymbol: row.assetSymbol,
      quote: parse(row.quoteJson),
      observation: parse(row.observationJson),
      freshness: parse(row.freshnessJson),
      priceBounds: parse(row.boundsJson),
      session: row.marketSession as IssuedQuoteRecord["session"],
      maxSlippageBps: row.maxSlippageBps,
      issuedAt: Math.floor(row.issuedAt.getTime() / 1000),
      expiresAt: Math.floor(row.expiresAt.getTime() / 1000),
      used: row.used,
    };
  }

  async consume(id: string): Promise<boolean> {
    const rows = await this.db
      .update(issuedQuotes)
      .set({ used: true })
      .where(and(eq(issuedQuotes.id, id), eq(issuedQuotes.used, false)))
      .returning({ id: issuedQuotes.id });
    return rows.length === 1;
  }
}

export interface TradeIntentInsert {
  id: string;
  quoteId: string;
  trader: string;
  assetSymbol: string;
  side: "buy" | "sell";
  amountIn: bigint;
  minAmountOut: bigint;
  deadline: bigint;
  calldata: string;
  intentHash: string;
}

export type TradeIntentRecord = typeof tradeIntents.$inferSelect;
export type TradeIntentStatus = TradeIntentRecord["status"];
export type MutableTradeIntentStatus = Exclude<TradeIntentStatus, "prepared">;
export type TransactionAssociationResult =
  "associated" | "already-associated" | "conflict" | "not-found";

const LEGAL_TRANSITION_SOURCES: Readonly<
  Record<MutableTradeIntentStatus, readonly TradeIntentStatus[]>
> = {
  // A refresh may observe enough confirmations to skip intermediate states.
  submitted: ["prepared", "submitted"],
  included: ["prepared", "submitted", "included"],
  verified: ["prepared", "submitted", "included", "verified"],
  failed: ["prepared", "submitted", "included"],
  // Verified rows may only move forward to reorged, never backward or failed.
  reorged: ["submitted", "included", "verified"],
};

const ACTIVE_TRANSACTION_STATUSES: ReadonlySet<TradeIntentStatus> = new Set([
  "submitted",
  "included",
  "verified",
]);

export function canTransitionIntentStatus(
  current: TradeIntentStatus,
  next: MutableTradeIntentStatus,
): boolean {
  return LEGAL_TRANSITION_SOURCES[next].includes(current);
}

/** Classify an immutable tx-hash association without parsing prose or mutating. */
export function classifyTransactionAssociation(
  current: Pick<TradeIntentRecord, "status" | "txHash"> | undefined,
  txHash: string,
): TransactionAssociationResult {
  if (current === undefined) return "not-found";
  if (current.txHash === null) return "conflict";
  if (current.txHash.toLowerCase() !== txHash.toLowerCase()) return "conflict";
  return ACTIVE_TRANSACTION_STATUSES.has(current.status) ? "already-associated" : "conflict";
}

export class DrizzleIntentStore {
  constructor(readonly db: Db) {}

  async insert(record: TradeIntentInsert) {
    const now = nowDate();
    await this.db.insert(tradeIntents).values({
      ...record,
      amountIn: record.amountIn.toString(),
      minAmountOut: record.minAmountOut.toString(),
      deadline: record.deadline.toString(),
      createdAt: now,
      updatedAt: now,
    });
  }

  async list(trader: string, limit = 50) {
    const boundedLimit = Number.isInteger(limit) ? Math.min(100, Math.max(1, limit)) : 50;
    return this.db
      .select()
      .from(tradeIntents)
      .where(eq(tradeIntents.trader, trader))
      .orderBy(desc(tradeIntents.createdAt))
      .limit(boundedLimit);
  }

  async get(id: string) {
    return (await this.db.select().from(tradeIntents).where(eq(tradeIntents.id, id)).limit(1))[0];
  }

  /**
   * Atomically move only from a legal source status. The WHERE clause is the
   * compare-and-swap guard, so concurrent refreshes cannot regress a terminal or
   * higher-order row. A tx hash may be filled once, but never replaced.
   */
  async markStatus(
    id: string,
    status: MutableTradeIntentStatus,
    evidence?: { txHash?: string; blockNumber?: bigint; blockHash?: string },
  ): Promise<TradeIntentRecord | null> {
    const transactionCondition =
      evidence?.txHash === undefined
        ? undefined
        : or(isNull(tradeIntents.txHash), eq(tradeIntents.txHash, evidence.txHash));
    const rows = await this.db
      .update(tradeIntents)
      .set({
        status,
        ...(evidence?.txHash !== undefined ? { txHash: evidence.txHash } : {}),
        ...(evidence?.blockNumber !== undefined
          ? { blockNumber: evidence.blockNumber.toString() }
          : {}),
        ...(evidence?.blockHash !== undefined ? { blockHash: evidence.blockHash } : {}),
        updatedAt: nowDate(),
      })
      .where(
        and(
          eq(tradeIntents.id, id),
          inArray(tradeIntents.status, LEGAL_TRANSITION_SOURCES[status]),
          transactionCondition,
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /** Bind a prepared intent to its first transaction hash exactly once. */
  async associateTransaction(id: string, txHash: string): Promise<TransactionAssociationResult> {
    const rows = await this.db
      .update(tradeIntents)
      .set({ status: "submitted", txHash, updatedAt: nowDate() })
      .where(
        and(
          eq(tradeIntents.id, id),
          eq(tradeIntents.status, "prepared"),
          isNull(tradeIntents.txHash),
        ),
      )
      .returning({ id: tradeIntents.id });
    if (rows.length === 1) return "associated";
    return classifyTransactionAssociation(await this.get(id), txHash);
  }
}
