import { questProgress, totalPoints, type GrowthActivity } from "@kyrox/core";

import { DEMO_ASSETS } from "../demo/market.js";
import { balanceOf, type DemoSession } from "../demo/session.js";

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** Growth counters derived from the signed demo ledger. */
export function demoGrowthActivity(session: DemoSession): GrowthActivity {
  const days = new Set(session.ledger.activity.map((fill) => dayKey(fill.createdAt)));
  const held = DEMO_ASSETS.filter((asset) => balanceOf(session, asset.symbol) > 0n).length;
  return {
    hasClaimedUsdc: balanceOf(session, "tUSDC") > 0n,
    tradeCount: session.ledger.activity.length,
    distinctTradeDays: days.size,
    distinctAssetsHeld: held,
    questionsAsked: session.growth?.questions ?? 0,
    qualifiedReferrals: 0,
    hasFeedback: (session.growth?.feedback.length ?? 0) > 0,
  };
}

export function demoGrowthSummary(session: DemoSession) {
  const activity = demoGrowthActivity(session);
  return {
    activity,
    quests: questProgress(activity),
    points: totalPoints(activity),
  };
}
