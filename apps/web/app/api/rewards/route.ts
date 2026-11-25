import {
  POINTS_DISCLOSURE,
  fromBaseUnits,
  questProgress,
  rankLeaderboard,
  referralCodeForAddress,
  totalPoints,
} from "@kyrox/core";
import { indexedTrades } from "@kyrox/db";
import {
  currentLeagueWeekStart,
  findUserByAddress,
  getGrowthActivity,
  listLeaderboard,
  listWeeklyLeaderboard,
  syncQuestAwards,
  upsertAppUser,
} from "@kyrox/db";

import { isDemoMode } from "@/lib/demo/mode";
import { readDemoSession } from "@/lib/demo/session";
import { appDatabase } from "@/lib/server/database";
import { demoGrowthSummary } from "@/lib/server/growth";
import { getSession } from "@/lib/server/session";
import { error, json, requestId, routeError } from "@/lib/server/http";
import { realizedPnlByWallet } from "@/lib/server/league";

export const dynamic = "force-dynamic";

function referralBase(req: Request): string {
  const configured =
    process.env["APP_ORIGIN"]?.trim() || process.env["NEXT_PUBLIC_APP_URL"]?.trim();
  return (configured && configured.length > 0 ? configured : new URL(req.url).origin).replace(
    /\/$/,
    "",
  );
}

export async function GET(req: Request) {
  const correlationId = requestId();
  try {
    const session = await getSession();
    if (session === null) return error("Sign in to view rewards.", 401, "auth", correlationId);

    if (isDemoMode()) {
      const demo = await readDemoSession();
      if (demo === null) return error("Sign in to view rewards.", 401, "auth", correlationId);
      const summary = demoGrowthSummary(demo);
      const code = referralCodeForAddress(demo.address);
      return json({
        mode: "demo",
        simulated: true,
        address: demo.address,
        points: summary.points,
        quests: summary.quests,
        activity: summary.activity,
        referralCode: code,
        referralUrl: `${referralBase(req)}/?ref=${code}`,
        leaderboard: [],
        leaderboardNote:
          "The live leaderboard needs durable testnet trades. Preview activity is local to this session.",
        disclosure: POINTS_DISCLOSURE,
      });
    }

    const db = appDatabase().db;
    let user = await findUserByAddress(db, session.address);
    if (user === null) {
      user = await upsertAppUser(db, { address: session.address });
    }
    if (user.status === "banned") {
      return error("This account is not eligible for rewards.", 403, "banned", correlationId);
    }
    await syncQuestAwards(db, session.address);
    const activity = await getGrowthActivity(db, session.address);
    const leagueStart = currentLeagueWeekStart();
    const [rows, weeklyRows, allTrades] = await Promise.all([
      listLeaderboard(db, 3, 50),
      listWeeklyLeaderboard(db, leagueStart, 3, 50),
      db.select().from(indexedTrades),
    ]);
    const leaderboard = rankLeaderboard(rows, 3).map((entry) => ({
      ...entry,
      isSelf: entry.address === session.address.toLowerCase(),
    }));
    const realized = realizedPnlByWallet(
      allTrades.map((trade) => ({
        userAddress: trade.userAddress,
        assetSymbol: trade.assetSymbol,
        side: trade.side,
        usdcAmount: BigInt(trade.usdcAmount),
        stockAmount: BigInt(trade.stockAmount),
        blockTime: trade.blockTime,
      })),
      leagueStart,
    );
    const weeklyLeaderboard = weeklyRows
      .map((entry) => {
        const pnl = realized.get(entry.address.toLowerCase()) ?? 0n;
        return {
          ...entry,
          isSelf: entry.address === session.address.toLowerCase(),
          realizedPnlUsdc: fromBaseUnits(pnl, 6),
          pnlUnits: pnl,
        };
      })
      .sort((a, b) => {
        if (a.pnlUnits !== b.pnlUnits) return a.pnlUnits < b.pnlUnits ? 1 : -1;
        if (a.points !== b.points) return b.points - a.points;
        return a.address.localeCompare(b.address);
      })
      .map((entry, index) => ({
        address: entry.address,
        points: entry.points,
        trades: entry.trades,
        status: entry.status,
        isSelf: entry.isSelf,
        realizedPnlUsdc: entry.realizedPnlUsdc,
        rank: index + 1,
      }));
    const growth = {
      hasClaimedUsdc: activity.hasClaimedUsdc,
      tradeCount: activity.tradeCount,
      distinctTradeDays: activity.distinctTradeDays,
      distinctAssetsHeld: activity.distinctAssetsHeld,
      questionsAsked: activity.questionsAsked,
      qualifiedReferrals: activity.qualifiedReferrals,
      hasFeedback: activity.hasFeedback,
    };
    return json({
      mode: "live",
      simulated: false,
      address: session.address,
      points: activity.points,
      quests: questProgress(growth),
      activity: growth,
      referralCode: user.referralCode,
      referralUrl: `${referralBase(req)}/?ref=${user.referralCode}`,
      leaderboard,
      weeklyLeaderboard,
      leagueWeekStart: leagueStart.toISOString(),
      leaderboardNote:
        "Only active wallets with at least three indexed trades appear. Flagged wallets are excluded until reviewed. Weekly ranks use realised P&L, not mark-to-market returns.",
      disclosure: POINTS_DISCLOSURE,
      totalPoints: totalPoints(growth),
    });
  } catch (err) {
    return routeError(err, "rewards_unavailable", correlationId);
  }
}
