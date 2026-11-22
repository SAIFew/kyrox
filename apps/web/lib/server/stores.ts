import { and, desc, eq, gte, isNull } from "drizzle-orm";

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
    return this.db
      .select()
      .from(tradeIntents)
      .where(eq(tradeIntents.trader, trader))
      .orderBy(desc(tradeIntents.createdAt))
      .limit(limit);
  }

  async get(id: string) {
    return (await this.db.select().from(tradeIntents).where(eq(tradeIntents.id, id)).limit(1))[0];
  }

  async markStatus(
    id: string,
    status: "submitted" | "included" | "verified" | "failed" | "reorged",
    evidence?: { txHash?: string; blockNumber?: bigint; blockHash?: string },
  ) {
    await this.db
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
      .where(eq(tradeIntents.id, id));
  }
}
