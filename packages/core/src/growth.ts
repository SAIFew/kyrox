/**
 * Testnet quests, points and referral rules.
 *
 * Points have no cash value and never convert to tokens. The definitions below
 * are the single source shared by the web app, the admin dashboard and tests so
 * a quest cannot be worth different amounts in different surfaces.
 */

export type QuestId =
  | "claim_usdc"
  | "first_trade"
  | "ask_three"
  | "portfolio_three"
  | "trade_three_days"
  | "invite_friend"
  | "feedback";

export interface QuestDefinition {
  readonly id: QuestId;
  readonly title: string;
  readonly description: string;
  readonly points: number;
  readonly repeatable: boolean;
  readonly maxCompletions: number;
}

export const QUESTS: readonly QuestDefinition[] = [
  {
    id: "claim_usdc",
    title: "Claim your test USDC",
    description: "Claim the 1,000 tUSDC welcome grant.",
    points: 10,
    repeatable: false,
    maxCompletions: 1,
  },
  {
    id: "first_trade",
    title: "Make your first trade",
    description: "Complete one buy or sell against the test exchange.",
    points: 50,
    repeatable: false,
    maxCompletions: 1,
  },
  {
    id: "ask_three",
    title: "Ask KYROX 3 questions",
    description: "Use the assistant three times for a price, quote or portfolio answer.",
    points: 20,
    repeatable: false,
    maxCompletions: 1,
  },
  {
    id: "portfolio_three",
    title: "Build a portfolio of 3+ stocks",
    description: "Hold at least three different test stocks at the same time.",
    points: 30,
    repeatable: false,
    maxCompletions: 1,
  },
  {
    id: "trade_three_days",
    title: "Trade on 3 different days",
    description: "Complete a trade on three separate UTC days.",
    points: 100,
    repeatable: false,
    maxCompletions: 1,
  },
  {
    id: "invite_friend",
    title: "Invite a friend who trades",
    description: "A referred wallet claims tUSDC and completes its first trade.",
    points: 100,
    repeatable: true,
    maxCompletions: 10,
  },
  {
    id: "feedback",
    title: "Give feedback",
    description: "Send one piece of product feedback.",
    points: 30,
    repeatable: false,
    maxCompletions: 1,
  },
] as const;

export const POINTS_DISCLOSURE =
  "Points have no cash value and no token value. They are not an airdrop, security, or promise of future payment.";

export interface GrowthActivity {
  readonly hasClaimedUsdc: boolean;
  readonly tradeCount: number;
  readonly distinctTradeDays: number;
  readonly distinctAssetsHeld: number;
  readonly questionsAsked: number;
  readonly qualifiedReferrals: number;
  readonly hasFeedback: boolean;
}

export interface QuestProgress {
  readonly quest: QuestDefinition;
  readonly completed: number;
  readonly target: number;
  readonly earnedPoints: number;
  readonly complete: boolean;
}

/** Progress is derived only from recorded activity; nothing is assumed. */
export function questProgress(activity: GrowthActivity): readonly QuestProgress[] {
  const counts: Record<QuestId, number> = {
    claim_usdc: activity.hasClaimedUsdc ? 1 : 0,
    first_trade: activity.tradeCount > 0 ? 1 : 0,
    ask_three: activity.questionsAsked >= 3 ? 1 : 0,
    portfolio_three: activity.distinctAssetsHeld >= 3 ? 1 : 0,
    trade_three_days: activity.distinctTradeDays >= 3 ? 1 : 0,
    invite_friend: activity.qualifiedReferrals,
    feedback: activity.hasFeedback ? 1 : 0,
  };

  return QUESTS.map((quest) => {
    const raw = Math.max(0, Math.min(quest.maxCompletions, counts[quest.id]));
    return {
      quest,
      completed: raw,
      target: quest.id === "invite_friend" ? Math.max(1, raw) : 1,
      earnedPoints: raw * quest.points,
      complete: raw >= 1,
    };
  });
}

export function totalPoints(activity: GrowthActivity): number {
  return questProgress(activity).reduce((total, item) => total + item.earnedPoints, 0);
}

export interface LeaderboardEntry {
  readonly address: string;
  readonly points: number;
  readonly trades: number;
  readonly status: "active" | "flagged" | "banned";
}

export interface RankedLeaderboardEntry extends LeaderboardEntry {
  readonly rank: number;
}

/**
 * Ranking requires at least three trades. Flagged and banned wallets remain
 * visible to admins but are excluded from public ranks until reviewed.
 */
export function rankLeaderboard(
  entries: readonly LeaderboardEntry[],
  minimumTrades = 3,
): readonly RankedLeaderboardEntry[] {
  return entries
    .filter((entry) => entry.status === "active" && entry.trades >= minimumTrades)
    .slice()
    .sort(
      (a, b) => b.points - a.points || b.trades - a.trades || a.address.localeCompare(b.address),
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/** Demo/preview referral code; live codes are random and unique in Postgres. */
export function referralCodeForAddress(address: string): string {
  const normalized = address.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    throw new Error("A 20-byte hex address is required for a referral code.");
  }
  return `KX${normalized.slice(0, 6).toUpperCase()}`;
}

export function isValidReferralCode(code: string): boolean {
  return /^KX[0-9A-F]{6}$/.test(code.toUpperCase());
}

export function normalizeReferralCode(code: string | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  const value = code.trim().toUpperCase();
  return isValidReferralCode(value) ? value : null;
}
