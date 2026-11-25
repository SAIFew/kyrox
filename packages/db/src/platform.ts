import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "./schema.js";

export type PlatformDb = NodePgDatabase<typeof schema>;

export interface UpsertUserInput {
  readonly address: string;
  readonly email?: string | null;
  readonly signupSource?: string | null;
  readonly signupIpHash?: string | null;
  readonly referredByCode?: string | null;
}

function normalizeAddress(address: string): string {
  const value = address.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(value)) throw new Error("A valid wallet address is required.");
  return value;
}

export function newReferralCode(): string {
  return `KX${randomBytes(3).toString("hex").toUpperCase()}`;
}

/** Stable, non-reversible IP fingerprint for abuse review. */
export function hashIpAddress(ip: string | null | undefined, secret: string): string | null {
  const value = ip?.trim();
  if (value === undefined || value.length === 0) return null;
  return createHash("sha256").update(`${secret}:${value}`).digest("hex").slice(0, 32);
}

export async function findUserByAddress(db: PlatformDb, address: string) {
  const normalized = normalizeAddress(address);
  const rows = await db
    .select()
    .from(schema.appUsers)
    .where(eq(schema.appUsers.address, normalized))
    .limit(1);
  return rows[0] ?? null;
}

export async function findUserByReferralCode(db: PlatformDb, code: string) {
  const normalized = code.trim().toUpperCase();
  const rows = await db
    .select()
    .from(schema.appUsers)
    .where(eq(schema.appUsers.referralCode, normalized))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Create or refresh a participant. Referral attribution happens once, on the
 * first insert, and never overwrites an existing relationship.
 */
export async function upsertAppUser(db: PlatformDb, input: UpsertUserInput) {
  const address = normalizeAddress(input.address);
  const existing = await findUserByAddress(db, address);
  const now = new Date();
  if (existing !== null) {
    const rows = await db
      .update(schema.appUsers)
      .set({
        lastActiveAt: now,
        ...(input.email === undefined || input.email === null ? {} : { email: input.email }),
      })
      .where(eq(schema.appUsers.id, existing.id))
      .returning();
    return rows[0] ?? existing;
  }

  let referrer: Awaited<ReturnType<typeof findUserByReferralCode>> = null;
  if (input.referredByCode !== undefined && input.referredByCode !== null) {
    referrer = await findUserByReferralCode(db, input.referredByCode);
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newReferralCode();
    try {
      const rows = await db
        .insert(schema.appUsers)
        .values({
          address,
          email: input.email ?? null,
          referralCode: code,
          referredBy: referrer !== null && referrer.address !== address ? referrer.address : null,
          signupSource: input.signupSource ?? null,
          signupIpHash: input.signupIpHash ?? null,
          status: "active",
          createdAt: now,
          lastActiveAt: now,
        })
        .returning();
      const user = rows[0];
      if (user === undefined) throw new Error("User insert returned no row.");
      if (referrer !== null && referrer.address !== address) {
        await db
          .insert(schema.referrals)
          .values({
            referrerUserId: referrer.id,
            refereeUserId: user.id,
            code: referrer.referralCode,
            createdAt: now,
          })
          .onConflictDoNothing();
        await insertUserEvent(db, {
          address,
          userId: user.id,
          name: "referral_joined",
          props: { code: referrer.referralCode },
        }).catch(() => undefined);
      }
      return user;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "23505" || attempt === 4) throw error;
    }
  }
  throw new Error("Could not allocate a unique referral code.");
}

export interface EventInput {
  readonly address?: string | null;
  readonly userId?: number | null;
  readonly name: string;
  readonly props?: unknown;
}

const EVENT_NAME = /^[a-z][a-z0-9_]{2,63}$/;

/** Product events the client/server may record. Full chat text is never stored. */
export const ALLOWED_USER_EVENTS = new Set([
  "signup",
  "faucet_claimed",
  "assistant_question",
  "quote_shown",
  "quote_refused",
  "trade_approved",
  "trade_landed",
  "trade_failed",
  "quest_completed",
  "referral_joined",
  "share_created",
  "share_clicked",
  "feedback_submitted",
  "basket_quote",
  "page_view",
  "client_error",
]);

export async function insertUserEvent(db: PlatformDb, input: EventInput): Promise<void> {
  if (!EVENT_NAME.test(input.name) || !ALLOWED_USER_EVENTS.has(input.name)) {
    throw new Error("Event name is not allowlisted.");
  }
  let userId = input.userId ?? null;
  let address: string | null = input.address ?? null;
  if (address !== null) {
    address = normalizeAddress(address);
    if (userId === null) {
      const user = await findUserByAddress(db, address);
      userId = user?.id ?? null;
    }
  }
  await db.insert(schema.userEvents).values({
    userId,
    address,
    name: input.name,
    props: input.props === undefined ? null : JSON.stringify(input.props),
    createdAt: new Date(),
  });
}

export async function awardPoints(
  db: PlatformDb,
  input: {
    readonly userId: number;
    readonly quest: string;
    readonly points: number;
    readonly sourceKey?: string;
  },
): Promise<boolean> {
  if (!Number.isSafeInteger(input.points) || input.points <= 0) return false;
  const rows = await db
    .insert(schema.pointsEntries)
    .values({
      userId: input.userId,
      quest: input.quest,
      points: input.points,
      sourceKey: input.sourceKey ?? "",
      createdAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: schema.pointsEntries.id });
  return rows.length > 0;
}

export interface GrowthActivityRecord {
  readonly hasClaimedUsdc: boolean;
  readonly tradeCount: number;
  readonly distinctTradeDays: number;
  readonly distinctAssetsHeld: number;
  readonly questionsAsked: number;
  readonly qualifiedReferrals: number;
  readonly hasFeedback: boolean;
  readonly points: number;
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Derive growth activity from durable records; never from client claims. */
export async function getGrowthActivity(
  db: PlatformDb,
  address: string,
): Promise<GrowthActivityRecord> {
  const normalized = normalizeAddress(address);
  const user = await findUserByAddress(db, normalized);
  if (user === null) {
    return {
      hasClaimedUsdc: false,
      tradeCount: 0,
      distinctTradeDays: 0,
      distinctAssetsHeld: 0,
      questionsAsked: 0,
      qualifiedReferrals: 0,
      hasFeedback: false,
      points: 0,
    };
  }

  const [trades, claims, asked, refs, feedback, points] = await Promise.all([
    db.select().from(schema.indexedTrades).where(eq(schema.indexedTrades.userAddress, normalized)),
    db.select().from(schema.indexedClaims).where(eq(schema.indexedClaims.userAddress, normalized)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.userEvents)
      .where(
        and(
          eq(schema.userEvents.userId, user.id),
          eq(schema.userEvents.name, "assistant_question"),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.referrals)
      .where(
        and(
          eq(schema.referrals.referrerUserId, user.id),
          sql`${schema.referrals.qualifiedAt} is not null`,
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.feedbackEntries)
      .where(eq(schema.feedbackEntries.userId, user.id)),
    db
      .select({ total: sql<number>`coalesce(sum(${schema.pointsEntries.points}), 0)::int` })
      .from(schema.pointsEntries)
      .where(eq(schema.pointsEntries.userId, user.id)),
  ]);

  const days = new Set(trades.map((trade) => utcDay(trade.blockTime)));
  const held = new Map<string, bigint>();
  for (const trade of trades) {
    const current = held.get(trade.assetSymbol) ?? 0n;
    const amount = BigInt(trade.stockAmount);
    held.set(trade.assetSymbol, trade.side === "buy" ? current + amount : current - amount);
  }

  return {
    hasClaimedUsdc: claims.length > 0,
    tradeCount: trades.length,
    distinctTradeDays: days.size,
    distinctAssetsHeld: [...held.values()].filter((amount) => amount > 0n).length,
    questionsAsked: asked[0]?.count ?? 0,
    qualifiedReferrals: refs[0]?.count ?? 0,
    hasFeedback: (feedback[0]?.count ?? 0) > 0,
    points: points[0]?.total ?? 0,
  };
}

const ONE_TIME_AWARDS = {
  claim_usdc: 10,
  first_trade: 50,
  ask_three: 20,
  portfolio_three: 30,
  trade_three_days: 100,
  feedback: 30,
} as const;

/**
 * Award one-time quests and qualify referrals after durable activity changes.
 * Idempotent: the points table has a unique (user, quest, source) key.
 */
export async function syncQuestAwards(db: PlatformDb, address: string): Promise<void> {
  const user = await findUserByAddress(db, address);
  if (user === null) return;
  const activity = await getGrowthActivity(db, address);

  const eligible: Array<keyof typeof ONE_TIME_AWARDS> = [];
  if (activity.hasClaimedUsdc) eligible.push("claim_usdc");
  if (activity.tradeCount > 0) eligible.push("first_trade");
  if (activity.questionsAsked >= 3) eligible.push("ask_three");
  if (activity.distinctAssetsHeld >= 3) eligible.push("portfolio_three");
  if (activity.distinctTradeDays >= 3) eligible.push("trade_three_days");
  if (activity.hasFeedback) eligible.push("feedback");

  for (const quest of eligible) {
    await awardPoints(db, {
      userId: user.id,
      quest,
      points: ONE_TIME_AWARDS[quest],
      sourceKey: "once",
    });
  }

  // A referral qualifies after the referee's first indexed trade.
  if (activity.tradeCount > 0) {
    const rows = await db
      .select()
      .from(schema.referrals)
      .where(eq(schema.referrals.refereeUserId, user.id));
    for (const referral of rows) {
      if (referral.qualifiedAt === null) {
        await db
          .update(schema.referrals)
          .set({ qualifiedAt: new Date() })
          .where(eq(schema.referrals.id, referral.id));
      }
      await awardPoints(db, {
        userId: referral.referrerUserId,
        quest: "invite_friend",
        points: 100,
        sourceKey: normalizedRefereeKey(user.address),
      });
    }
  }
}

function normalizedRefereeKey(address: string): string {
  return normalizeAddress(address);
}

export interface LeaderboardRow {
  readonly address: string;
  readonly points: number;
  readonly trades: number;
  readonly status: "active" | "flagged" | "banned";
}

export async function listLeaderboard(
  db: PlatformDb,
  minimumTrades = 3,
  limit = 50,
): Promise<readonly LeaderboardRow[]> {
  const rows = await db
    .select({
      address: schema.appUsers.address,
      status: schema.appUsers.status,
      points: sql<number>`coalesce(sum(${schema.pointsEntries.points}), 0)::int`,
      trades: sql<number>`(select count(*)::int from ${schema.indexedTrades} where ${schema.indexedTrades.userAddress} = ${schema.appUsers.address})`,
    })
    .from(schema.appUsers)
    .leftJoin(schema.pointsEntries, eq(schema.pointsEntries.userId, schema.appUsers.id))
    .groupBy(schema.appUsers.id, schema.appUsers.address, schema.appUsers.status)
    .orderBy(desc(sql`coalesce(sum(${schema.pointsEntries.points}), 0)`))
    .limit(limit);
  return rows
    .filter((row) => row.status === "active" && row.trades >= minimumTrades)
    .map((row) => ({
      address: row.address,
      points: row.points,
      trades: row.trades,
      status: row.status,
    }));
}

export async function insertFeedback(
  db: PlatformDb,
  input: { readonly address: string; readonly topic: string; readonly message: string },
): Promise<void> {
  const user = await findUserByAddress(db, input.address);
  await db.insert(schema.feedbackEntries).values({
    userId: user?.id ?? null,
    address: normalizeAddress(input.address),
    topic: input.topic.slice(0, 64),
    message: input.message.slice(0, 4_000),
    status: "new",
    createdAt: new Date(),
  });
}

export interface IndexedTradeInput {
  readonly chainId: number;
  readonly txHash: string;
  readonly logIndex: number;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly blockTime: Date;
  readonly userAddress: string;
  readonly stockToken: string;
  readonly assetSymbol: string;
  readonly side: "buy" | "sell";
  readonly usdcAmount: bigint;
  readonly stockAmount: bigint;
  readonly priceUsdcPerWholeToken: bigint;
}

export async function upsertIndexedTrade(db: PlatformDb, trade: IndexedTradeInput) {
  await db
    .insert(schema.indexedTrades)
    .values({
      chainId: trade.chainId,
      txHash: trade.txHash,
      logIndex: trade.logIndex,
      blockNumber: trade.blockNumber.toString(),
      blockHash: trade.blockHash,
      blockTime: trade.blockTime,
      userAddress: normalizeAddress(trade.userAddress),
      stockToken: trade.stockToken.toLowerCase(),
      assetSymbol: trade.assetSymbol,
      side: trade.side,
      usdcAmount: trade.usdcAmount.toString(),
      stockAmount: trade.stockAmount.toString(),
      priceUsdcPerWholeToken: trade.priceUsdcPerWholeToken.toString(),
      createdAt: new Date(),
    })
    .onConflictDoNothing();
  await insertUserEvent(db, {
    address: trade.userAddress,
    name: "trade_landed",
    props: { symbol: trade.assetSymbol, side: trade.side },
  });
  await syncQuestAwards(db, trade.userAddress);
}

export interface IndexedClaimInput {
  readonly chainId: number;
  readonly txHash: string;
  readonly logIndex: number;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly blockTime: Date;
  readonly userAddress: string;
  readonly amount: bigint;
  readonly kind: "welcome" | "daily";
}

export async function upsertIndexedClaim(db: PlatformDb, claim: IndexedClaimInput) {
  await db
    .insert(schema.indexedClaims)
    .values({
      chainId: claim.chainId,
      txHash: claim.txHash,
      logIndex: claim.logIndex,
      blockNumber: claim.blockNumber.toString(),
      blockHash: claim.blockHash,
      blockTime: claim.blockTime,
      userAddress: normalizeAddress(claim.userAddress),
      amount: claim.amount.toString(),
      kind: claim.kind,
      createdAt: new Date(),
    })
    .onConflictDoNothing();
  await insertUserEvent(db, {
    address: claim.userAddress,
    name: "faucet_claimed",
    props: { kind: claim.kind },
  });
  await syncQuestAwards(db, claim.userAddress);
}

export async function getCheckpoint(db: PlatformDb, stream: string) {
  const rows = await db
    .select()
    .from(schema.indexerCheckpoints)
    .where(eq(schema.indexerCheckpoints.stream, stream))
    .limit(1);
  return rows[0] ?? null;
}

export async function saveCheckpoint(
  db: PlatformDb,
  input: { stream: string; chainId: number; blockNumber: bigint; blockHash: string },
): Promise<void> {
  await db
    .insert(schema.indexerCheckpoints)
    .values({
      stream: input.stream,
      chainId: input.chainId,
      blockNumber: input.blockNumber.toString(),
      blockHash: input.blockHash,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.indexerCheckpoints.stream,
      set: {
        chainId: input.chainId,
        blockNumber: input.blockNumber.toString(),
        blockHash: input.blockHash,
        updatedAt: new Date(),
      },
    });
}

/** Drop logs above a reorg point so they can be re-indexed from canonical blocks. */
export async function rewindIndexedLogs(
  db: PlatformDb,
  chainId: number,
  blockNumber: bigint,
): Promise<void> {
  const height = blockNumber.toString();
  await Promise.all([
    db
      .delete(schema.indexedTrades)
      .where(
        and(
          eq(schema.indexedTrades.chainId, chainId),
          gte(schema.indexedTrades.blockNumber, height),
        ),
      ),
    db
      .delete(schema.indexedClaims)
      .where(
        and(
          eq(schema.indexedClaims.chainId, chainId),
          gte(schema.indexedClaims.blockNumber, height),
        ),
      ),
  ]);
}

/** Analytics counts for the admin dashboard. */
export async function analyticsSummary(db: PlatformDb, since: Date) {
  const rows = await db
    .select({
      name: schema.userEvents.name,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.userEvents)
    .where(gte(schema.userEvents.createdAt, since))
    .groupBy(schema.userEvents.name)
    .orderBy(desc(sql`count(*)`));
  return rows;
}

export async function clearCheckpoint(db: PlatformDb, stream: string): Promise<void> {
  await db.delete(schema.indexerCheckpoints).where(eq(schema.indexerCheckpoints.stream, stream));
}

/**
 * Fulfil a verified deletion request. Trade/claim rows are keyed by wallet, so
 * they are removed explicitly; the security audit log keeps the action but not
 * the wallet as its target.
 */
export async function deleteUserData(db: PlatformDb, address: string): Promise<void> {
  const normalized = normalizeAddress(address);
  const user = await findUserByAddress(db, normalized);
  if (user === null) return;
  await db.delete(schema.indexedTrades).where(eq(schema.indexedTrades.userAddress, normalized));
  await db.delete(schema.indexedClaims).where(eq(schema.indexedClaims.userAddress, normalized));
  await db.delete(schema.feedbackEntries).where(eq(schema.feedbackEntries.address, normalized));
  await db.delete(schema.appUsers).where(eq(schema.appUsers.id, user.id));
}

/** Points and trades earned since a supplied instant (weekly league). */
export async function listWeeklyLeaderboard(
  db: PlatformDb,
  since: Date,
  minimumTrades = 3,
  limit = 50,
): Promise<readonly LeaderboardRow[]> {
  const rows = await db
    .select({
      address: schema.appUsers.address,
      status: schema.appUsers.status,
      points: sql<number>`coalesce(sum(${schema.pointsEntries.points}), 0)::int`,
      trades: sql<number>`(select count(*)::int from ${schema.indexedTrades} where ${schema.indexedTrades.userAddress} = ${schema.appUsers.address} and ${schema.indexedTrades.blockTime} >= ${since})`,
    })
    .from(schema.appUsers)
    .leftJoin(
      schema.pointsEntries,
      and(
        eq(schema.pointsEntries.userId, schema.appUsers.id),
        gte(schema.pointsEntries.createdAt, since),
      ),
    )
    .groupBy(schema.appUsers.id, schema.appUsers.address, schema.appUsers.status)
    .orderBy(desc(sql`coalesce(sum(${schema.pointsEntries.points}), 0)`))
    .limit(limit);
  return rows
    .filter((row) => row.status === "active" && row.trades >= minimumTrades)
    .map((row) => ({
      address: row.address,
      points: row.points,
      trades: row.trades,
      status: row.status,
    }));
}

/** Monday 00:00 UTC for the current Trading League week. */
export function currentLeagueWeekStart(now = new Date()): Date {
  const day = now.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday),
  );
}
