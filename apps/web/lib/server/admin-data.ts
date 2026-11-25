import {
  adminAuditLog,
  appEvents,
  appUsers,
  feedbackEntries,
  indexedClaims,
  indexedTrades,
  pointsEntries,
  referrals,
  userEvents,
  type PlatformDb,
} from "@kyrox/db";
import { and, desc, eq, gte, ilike, or, sql } from "drizzle-orm";

export interface AdminOverview {
  readonly registered: number;
  readonly registeredToday: number;
  readonly traders: number;
  readonly returningTraders: number;
  readonly volumeUsdc: string;
  readonly trades: number;
  readonly claims: number;
  readonly claimedUsdc: string;
  readonly flagged: number;
  readonly refusals: number;
  readonly topStocks: ReadonlyArray<{ symbol: string; trades: number }>;
}

function dayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export async function getAdminOverview(db: PlatformDb): Promise<AdminOverview> {
  const [users, trades, claims, flagged, refusals, top] = await Promise.all([
    db.select().from(appUsers),
    db.select().from(indexedTrades),
    db.select().from(indexedClaims),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(appUsers)
      .where(eq(appUsers.status, "flagged")),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(userEvents)
      .where(eq(userEvents.name, "quote_refused")),
    db
      .select({
        symbol: indexedTrades.assetSymbol,
        trades: sql<number>`count(*)::int`,
      })
      .from(indexedTrades)
      .groupBy(indexedTrades.assetSymbol)
      .orderBy(desc(sql`count(*)`))
      .limit(5),
  ]);

  const today = dayKey(new Date());
  const traderDays = new Map<string, Set<string>>();
  let volume = 0n;
  for (const trade of trades) {
    volume += BigInt(trade.usdcAmount);
    const days = traderDays.get(trade.userAddress) ?? new Set<string>();
    days.add(dayKey(trade.blockTime));
    traderDays.set(trade.userAddress, days);
  }
  let claimed = 0n;
  for (const claim of claims) claimed += BigInt(claim.amount);

  return {
    registered: users.length,
    registeredToday: users.filter((user) => dayKey(user.createdAt) === today).length,
    traders: traderDays.size,
    returningTraders: [...traderDays.values()].filter((days) => days.size >= 2).length,
    volumeUsdc: volume.toString(),
    trades: trades.length,
    claims: claims.length,
    claimedUsdc: claimed.toString(),
    flagged: flagged[0]?.count ?? 0,
    refusals: refusals[0]?.count ?? 0,
    topStocks: top,
  };
}

export interface AdminUserRow {
  readonly id: number;
  readonly address: string;
  readonly referralCode: string;
  readonly referredBy: string | null;
  readonly signupSource: string | null;
  readonly status: "active" | "flagged" | "banned";
  readonly notes: string | null;
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
  readonly trades: number;
  readonly points: number;
}

export async function listAdminUsers(
  db: PlatformDb,
  input: { readonly query?: string; readonly status?: string; readonly limit?: number } = {},
): Promise<readonly AdminUserRow[]> {
  const status =
    input.status === "active" || input.status === "flagged" || input.status === "banned"
      ? input.status
      : undefined;
  const search = input.query?.trim();
  const where = and(
    status === undefined ? undefined : eq(appUsers.status, status),
    search === undefined || search.length === 0
      ? undefined
      : or(ilike(appUsers.address, `%${search}%`), ilike(appUsers.referralCode, `%${search}%`)),
  );

  const rows = await db
    .select({
      id: appUsers.id,
      address: appUsers.address,
      referralCode: appUsers.referralCode,
      referredBy: appUsers.referredBy,
      signupSource: appUsers.signupSource,
      status: appUsers.status,
      notes: appUsers.notes,
      createdAt: appUsers.createdAt,
      lastActiveAt: appUsers.lastActiveAt,
      trades: sql<number>`(select count(*)::int from ${indexedTrades} where ${indexedTrades.userAddress} = ${appUsers.address})`,
      points: sql<number>`(select coalesce(sum(${pointsEntries.points}), 0)::int from ${pointsEntries} where ${pointsEntries.userId} = ${appUsers.id})`,
    })
    .from(appUsers)
    .where(where)
    .orderBy(desc(appUsers.lastActiveAt))
    .limit(Math.min(input.limit ?? 200, 500));
  return rows;
}

export async function getAdminUserDetail(db: PlatformDb, address: string) {
  const normalized = address.toLowerCase();
  const rows = await db.select().from(appUsers).where(eq(appUsers.address, normalized)).limit(1);
  const user = rows[0] ?? null;
  if (user === null) return null;
  const [trades, claims, points, events, refs, feedback] = await Promise.all([
    db
      .select()
      .from(indexedTrades)
      .where(eq(indexedTrades.userAddress, normalized))
      .orderBy(desc(indexedTrades.blockTime))
      .limit(100),
    db
      .select()
      .from(indexedClaims)
      .where(eq(indexedClaims.userAddress, normalized))
      .orderBy(desc(indexedClaims.blockTime))
      .limit(50),
    db
      .select()
      .from(pointsEntries)
      .where(eq(pointsEntries.userId, user.id))
      .orderBy(desc(pointsEntries.createdAt))
      .limit(100),
    db
      .select()
      .from(userEvents)
      .where(eq(userEvents.userId, user.id))
      .orderBy(desc(userEvents.createdAt))
      .limit(200),
    db
      .select()
      .from(referrals)
      .where(or(eq(referrals.referrerUserId, user.id), eq(referrals.refereeUserId, user.id))),
    db
      .select()
      .from(feedbackEntries)
      .where(eq(feedbackEntries.userId, user.id))
      .orderBy(desc(feedbackEntries.createdAt)),
  ]);
  return { user, trades, claims, points, events, referrals: refs, feedback };
}

export async function listAdminTrades(db: PlatformDb, limit = 200) {
  return db.select().from(indexedTrades).orderBy(desc(indexedTrades.blockTime)).limit(limit);
}

export async function listAdminClaims(db: PlatformDb, limit = 200) {
  return db.select().from(indexedClaims).orderBy(desc(indexedClaims.blockTime)).limit(limit);
}

export async function listAdminAudit(db: PlatformDb, limit = 200) {
  return db.select().from(adminAuditLog).orderBy(desc(adminAuditLog.createdAt)).limit(limit);
}

export async function listAdminFeedback(db: PlatformDb, limit = 200) {
  return db.select().from(feedbackEntries).orderBy(desc(feedbackEntries.createdAt)).limit(limit);
}

export async function listAdminErrors(db: PlatformDb, limit = 100) {
  return db
    .select()
    .from(appEvents)
    .where(or(eq(appEvents.level, "warn"), eq(appEvents.level, "error")))
    .orderBy(desc(appEvents.createdAt))
    .limit(limit);
}

export async function analyticsCounts(db: PlatformDb, since: Date) {
  return db
    .select({ name: userEvents.name, count: sql<number>`count(*)::int` })
    .from(userEvents)
    .where(gte(userEvents.createdAt, since))
    .groupBy(userEvents.name)
    .orderBy(desc(sql`count(*)`));
}

export interface SybilSignal {
  readonly address: string;
  readonly reasons: readonly string[];
}

/**
 * Heuristic review suggestions, not automatic bans. A human decides whether a
 * wallet is farming; flagged wallets keep access but leave public ranks.
 */
export async function listSybilSignals(db: PlatformDb): Promise<readonly SybilSignal[]> {
  const [users, trades, claims, refs] = await Promise.all([
    db.select().from(appUsers),
    db.select().from(indexedTrades),
    db.select().from(indexedClaims),
    db.select().from(referrals),
  ]);
  const reasons = new Map<string, string[]>();
  const add = (address: string, reason: string) => {
    const list = reasons.get(address) ?? [];
    list.push(reason);
    reasons.set(address, list);
  };

  const byIp = new Map<string, string[]>();
  for (const user of users) {
    if (user.signupIpHash === null) continue;
    const list = byIp.get(user.signupIpHash) ?? [];
    list.push(user.address);
    byIp.set(user.signupIpHash, list);
  }
  for (const addresses of byIp.values()) {
    if (addresses.length >= 3) {
      for (const address of addresses) {
        add(address, `${addresses.length} wallets share this signup IP fingerprint`);
      }
    }
  }

  const tradesByUser = new Map<string, typeof trades>();
  for (const trade of trades) {
    const list = tradesByUser.get(trade.userAddress) ?? [];
    list.push(trade);
    tradesByUser.set(trade.userAddress, list);
  }
  const claimsByUser = new Map<string, number>();
  for (const claim of claims) {
    claimsByUser.set(claim.userAddress, (claimsByUser.get(claim.userAddress) ?? 0) + 1);
  }

  for (const user of users) {
    const count = tradesByUser.get(user.address)?.length ?? 0;
    if ((claimsByUser.get(user.address) ?? 0) > 0 && count === 0) {
      add(user.address, "Claimed tUSDC but has no indexed trade");
    }
  }

  const burst = new Map<string, Set<string>>();
  for (const trade of trades) {
    const bucket = `${trade.usdcAmount}|${Math.floor(trade.blockTime.getTime() / 600_000)}`;
    const wallets = burst.get(bucket) ?? new Set<string>();
    wallets.add(trade.userAddress);
    burst.set(bucket, wallets);
  }
  for (const wallets of burst.values()) {
    if (wallets.size >= 3) {
      for (const address of wallets) {
        add(address, "Identical trade size within ten minutes across multiple wallets");
      }
    }
  }

  const refsByReferrer = new Map<number, typeof refs>();
  for (const referral of refs) {
    const list = refsByReferrer.get(referral.referrerUserId) ?? [];
    list.push(referral);
    refsByReferrer.set(referral.referrerUserId, list);
  }
  for (const [referrerId, list] of refsByReferrer) {
    const referrer = users.find((user) => user.id === referrerId);
    if (referrer === undefined || list.length < 3) continue;
    const allMinimum = list.every((referral) => {
      const referee = users.find((user) => user.id === referral.refereeUserId);
      const refereeTrades = referee === undefined ? [] : (tradesByUser.get(referee.address) ?? []);
      return (
        refereeTrades.length === 1 && BigInt(refereeTrades[0]?.usdcAmount ?? "0") <= 1_100_000n
      );
    });
    if (allMinimum) {
      add(referrer.address, "Referral chain: every referee traded once at near-minimum size");
    }
  }

  return [...reasons.entries()]
    .map(([address, list]) => ({ address, reasons: [...new Set(list)] }))
    .sort((a, b) => b.reasons.length - a.reasons.length || a.address.localeCompare(b.address))
    .slice(0, 100);
}
