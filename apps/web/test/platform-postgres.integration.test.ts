import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  awardPoints,
  createDatabase,
  getGrowthActivity,
  insertUserEvent,
  listLeaderboard,
  syncQuestAwards,
  upsertAppUser,
  upsertIndexedClaim,
  upsertIndexedTrade,
  deleteUserData,
  findUserByAddress,
} from "@kyrox/db";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getAdminOverview, listAdminUsers, listSybilSignals } from "../lib/server/admin-data.js";
import { readEffectivePolicy, writeEffectivePolicy } from "../lib/server/policy-store.js";

const connectionString = process.env["KYROX_TEST_DATABASE_URL"] ?? "";
const enabled = connectionString.length > 0;
const migrationsFolder = fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url));

function wallet(): string {
  return `0x${randomBytes(20).toString("hex")}`;
}

describe.skipIf(!enabled)("platform database", () => {
  const database = enabled ? createDatabase(connectionString) : null;
  beforeAll(async () => {
    if (database !== null) await migrate(database!.db, { migrationsFolder });
  });
  afterAll(async () => {
    if (database !== null) await database.pool.end();
  });

  it("creates a user once, attributes a referral, and awards points idempotently", async () => {
    const referrerAddress = wallet();
    const refereeAddress = wallet();
    const referrer = await upsertAppUser(database!.db, { address: referrerAddress });
    const again = await upsertAppUser(database!.db, { address: referrerAddress });
    expect(again.id).toBe(referrer.id);
    expect(referrer.referralCode).toMatch(/^KX[0-9A-F]{6}$/);

    const referee = await upsertAppUser(database!.db, {
      address: refereeAddress,
      referredByCode: referrer.referralCode,
    });
    expect(referee.referredBy).toBe(referrerAddress.toLowerCase());

    expect(
      await awardPoints(database!.db, { userId: referee.id, quest: "first_trade", points: 50 }),
    ).toBe(true);
    expect(
      await awardPoints(database!.db, { userId: referee.id, quest: "first_trade", points: 50 }),
    ).toBe(false);

    const now = new Date();
    await upsertIndexedTrade(database!.db, {
      chainId: 84_532,
      txHash: `0x${randomBytes(32).toString("hex")}`,
      logIndex: 0,
      blockNumber: 10n,
      blockHash: `0x${randomBytes(32).toString("hex")}`,
      blockTime: now,
      userAddress: refereeAddress,
      stockToken: "0x2222222222222222222222222222222222222222",
      assetSymbol: "tAAPL",
      side: "buy",
      usdcAmount: 100_000_000n,
      stockAmount: 1_000_000_000_000_000_000n,
      priceUsdcPerWholeToken: 100_000_000n,
    });
    await syncQuestAwards(database!.db, refereeAddress);

    const activity = await getGrowthActivity(database!.db, refereeAddress);
    expect(activity.tradeCount).toBe(1);
    expect(activity.qualifiedReferrals).toBe(0);

    const referrerActivity = await getGrowthActivity(database!.db, referrerAddress);
    expect(referrerActivity.qualifiedReferrals).toBe(1);
    expect(referrerActivity.points).toBe(100);

    const board = await listLeaderboard(database!.db, 1);
    expect(board.some((entry) => entry.address === refereeAddress.toLowerCase())).toBe(true);
  });

  it("rejects unknown analytics event names", async () => {
    const address = wallet();
    await upsertAppUser(database!.db, { address });
    await expect(insertUserEvent(database!.db, { address, name: "raw_chat_text" })).rejects.toThrow(
      /allowlisted/,
    );
    await expect(
      insertUserEvent(database!.db, { address, name: "quote_shown" }),
    ).resolves.toBeUndefined();
  });

  it("persists a tightened policy and rejects widening", async () => {
    const policy = await writeEffectivePolicy(
      database!.db,
      {
        minTradeUsdc: 2_000_000n,
        maxTradeUsdc: 500_000_000n,
        dailyLimitUsdc: 1_000_000_000n,
        allowedAssets: ["tAAPL", "tNVDA"],
        tradingEnabled: false,
      },
      wallet(),
    );
    expect(policy.allowedAssets).toEqual(["tAAPL", "tNVDA"]);
    const stored = await readEffectivePolicy(database!.db);
    expect(stored.tradingEnabled).toBe(false);
    await expect(
      writeEffectivePolicy(database!.db, { maxTradeUsdc: 2_000_000_000n }, wallet()),
    ).rejects.toThrow(/launch maximum/);
  });

  it("deletes a user and their personal rows on request", async () => {
    const address = wallet();
    await upsertAppUser(database!.db, { address });
    await deleteUserData(database!.db, address);
    expect(await findUserByAddress(database!.db, address)).toBeNull();
  });

  it("serves admin overview, user lists, and sybil suggestions", async () => {
    const overview = await getAdminOverview(database!.db);
    expect(overview.registered).toBeGreaterThan(0);
    const users = await listAdminUsers(database!.db, { limit: 10 });
    expect(users.length).toBeGreaterThan(0);
    const signals = await listSybilSignals(database!.db);
    expect(Array.isArray(signals)).toBe(true);
  });

  it("records a welcome claim and derives the claim quest", async () => {
    const address = wallet();
    await upsertAppUser(database!.db, { address });
    await upsertIndexedClaim(database!.db, {
      chainId: 84_532,
      txHash: `0x${randomBytes(32).toString("hex")}`,
      logIndex: 1,
      blockNumber: 11n,
      blockHash: `0x${randomBytes(32).toString("hex")}`,
      blockTime: new Date(),
      userAddress: address,
      amount: 1_000_000_000n,
      kind: "welcome",
    });
    const activity = await getGrowthActivity(database!.db, address);
    expect(activity.hasClaimedUsdc).toBe(true);
    expect(activity.points).toBeGreaterThanOrEqual(10);
  });
});
