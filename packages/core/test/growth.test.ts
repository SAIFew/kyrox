import { describe, expect, it } from "vitest";

import {
  QUESTS,
  POINTS_DISCLOSURE,
  questProgress,
  rankLeaderboard,
  referralCodeForAddress,
  totalPoints,
  type GrowthActivity,
} from "../src/growth.js";

const empty: GrowthActivity = {
  hasClaimedUsdc: false,
  tradeCount: 0,
  distinctTradeDays: 0,
  distinctAssetsHeld: 0,
  questionsAsked: 0,
  qualifiedReferrals: 0,
  hasFeedback: false,
};

describe("quests and points", () => {
  it("awards the documented point values exactly once", () => {
    expect(QUESTS.map((quest) => [quest.id, quest.points])).toEqual([
      ["claim_usdc", 10],
      ["first_trade", 50],
      ["ask_three", 20],
      ["portfolio_three", 30],
      ["trade_three_days", 100],
      ["invite_friend", 100],
      ["feedback", 30],
    ]);
    expect(POINTS_DISCLOSURE).toContain("no cash value");
    expect(totalPoints(empty)).toBe(0);
    const completed = questProgress({
      ...empty,
      hasClaimedUsdc: true,
      tradeCount: 1,
      questionsAsked: 3,
      distinctAssetsHeld: 3,
      distinctTradeDays: 3,
      qualifiedReferrals: 2,
      hasFeedback: true,
    });
    expect(completed.every((item) => item.complete)).toBe(true);
    expect(
      totalPoints({
        ...empty,
        hasClaimedUsdc: true,
        tradeCount: 1,
        questionsAsked: 3,
        distinctAssetsHeld: 3,
        distinctTradeDays: 3,
        qualifiedReferrals: 2,
        hasFeedback: true,
      }),
    ).toBe(10 + 50 + 20 + 30 + 100 + 200 + 30);
  });

  it("caps repeatable referrals at ten", () => {
    const progress = questProgress({ ...empty, qualifiedReferrals: 25 });
    const invites = progress.find((item) => item.quest.id === "invite_friend");
    expect(invites?.earnedPoints).toBe(1_000);
    expect(invites?.target).toBe(10);
  });
});

describe("leaderboard", () => {
  it("requires three trades and excludes flagged wallets", () => {
    const ranked = rankLeaderboard([
      { address: "0x1", points: 100, trades: 3, status: "active" },
      { address: "0x2", points: 200, trades: 2, status: "active" },
      { address: "0x3", points: 300, trades: 5, status: "flagged" },
      { address: "0x4", points: 100, trades: 4, status: "active" },
    ]);
    expect(ranked.map((entry) => entry.address)).toEqual(["0x4", "0x1"]);
    expect(ranked.map((entry) => entry.rank)).toEqual([1, 2]);
  });
});

describe("referral codes", () => {
  it("derives a stable code from a wallet address", () => {
    const address = "0x1234567890abcdef1234567890abcdef12345678";
    expect(referralCodeForAddress(address)).toBe("KX123456");
    expect(() => referralCodeForAddress("nope")).toThrow();
  });
});
