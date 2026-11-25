import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { createQuote, type Address, type AssetDefinition } from "@kyrox/core";
import type { IssuedQuoteRecord } from "@kyrox/trade-intent";
import { createDatabase } from "@kyrox/db";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { issueNonce, requireSession, verifyAuthentication } from "../lib/server/auth.js";
import {
  DrizzleAuthStore,
  DrizzleIntentStore,
  DrizzleQuoteStore,
  type TradeIntentInsert,
} from "../lib/server/stores.js";

const connectionString = process.env["KYROX_TEST_DATABASE_URL"] ?? "";
const enabled = connectionString.length > 0;
const migrationsFolder = fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url));
const NOW = new Date("2026-11-24T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1_000);
const TRADER = "0x3333333333333333333333333333333333333333" as Address;
const OTHER = "0x9999999999999999999999999999999999999999" as Address;
const TOKEN = "0x2222222222222222222222222222222222222222" as Address;
const FEED = "0x4444444444444444444444444444444444444444" as Address;

const asset: AssetDefinition = {
  symbol: "tAAPL",
  name: "Test Apple",
  stockToken: TOKEN,
  stockDecimals: 18,
  priceSourceKind: "chainlink-coinbase",
  listed: true,
};
const observation = {
  assetSymbol: "tAAPL",
  priceUsdcPerWholeToken: 230_000_000n,
  sourceRoundId: 42n,
  sourceUpdatedAt: NOW_SECONDS - 5,
  observedAt: NOW_SECONDS - 2,
  sourceChainId: 8_453,
  feedAddress: FEED,
  sourceKind: "chainlink-coinbase" as const,
};
const freshness = {
  assetSymbol: "tAAPL",
  maxSourceAgeSeconds: 60,
  requireOpenMarket: true,
};
const priceBounds = { minPriceUsdcPerWholeToken: 1n, maxPriceUsdcPerWholeToken: 10n ** 12n };
const quote = createQuote(
  { assetSymbol: "tAAPL", side: "buy", amountIn: 1_000_000n, maxSlippageBps: 50 },
  asset,
  observation,
  {
    nowSeconds: NOW_SECONDS,
    chainId: 84_532,
    freshnessConfig: freshness,
    session: "open",
    priceBounds,
    quoteTtlSeconds: 60,
  },
);

function quoteRecord(id = "quote-1"): IssuedQuoteRecord {
  return {
    id,
    trader: TRADER,
    assetSymbol: "tAAPL",
    quote,
    observation,
    freshness,
    priceBounds,
    session: "open",
    maxSlippageBps: 50,
    issuedAt: NOW_SECONDS,
    expiresAt: NOW_SECONDS + 60,
    used: false,
  };
}

function intent(id: string, quoteId: string, trader = TRADER): TradeIntentInsert {
  return {
    id,
    quoteId,
    trader,
    assetSymbol: "tAAPL",
    side: "buy",
    amountIn: 1_000_000n,
    minAmountOut: quote.minAmountOut,
    deadline: BigInt(NOW_SECONDS + 60),
    calldata: "0x1234",
    intentHash: `0x${"ab".repeat(32)}`,
  };
}

/** Real PostgreSQL coverage for the consumer auth, quote, and intent stores. */
describe.skipIf(!enabled)("PostgreSQL consumer stores", () => {
  let handle: ReturnType<typeof createDatabase>;
  let auth: DrizzleAuthStore;
  let quotes: DrizzleQuoteStore;
  let intents: DrizzleIntentStore;

  beforeAll(async () => {
    handle = createDatabase(connectionString);
    await migrate(handle.db, { migrationsFolder });
    auth = new DrizzleAuthStore(handle.db);
    quotes = new DrizzleQuoteStore(handle.db);
    intents = new DrizzleIntentStore(handle.db);
  }, 60_000);

  beforeEach(async () => {
    await handle.db.execute(
      sql`TRUNCATE TABLE "auth_nonces", "auth_sessions", "issued_quotes", "trade_intents" RESTART IDENTITY CASCADE`,
    );
  });

  afterAll(async () => {
    await handle?.pool.end();
  });

  it("applies consumer migrations and their lookup indexes", async () => {
    const result = await handle.pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename IN ('auth_nonces', 'auth_sessions', 'issued_quotes', 'trade_intents')`,
    );
    const names = result.rows.map((row) => row.indexname);
    expect(names).toEqual(
      expect.arrayContaining([
        "auth_nonces_pkey",
        "auth_sessions_pkey",
        "issued_quotes_pkey",
        "issued_quotes_trader_idx",
        "trade_intents_pkey",
        "trade_intents_trader_idx",
        "trade_intents_quote_unique",
      ]),
    );
  });

  it("persists a signed-in session and rejects nonce replay", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const message = await issueNonce(auth, account.address.toLowerCase(), NOW);
    const nonce = /Nonce: ([a-f0-9]+)/.exec(message)?.[1];
    expect(nonce).toBeDefined();
    const signature = await account.signMessage({ message });
    const signedIn = await verifyAuthentication(auth, message, signature, NOW);
    expect(await requireSession(auth, signedIn.token, NOW)).toMatchObject({
      address: account.address.toLowerCase(),
    });
    await expect(verifyAuthentication(auth, message, signature, NOW)).rejects.toMatchObject({
      code: "NONCE_REPLAYED",
    });
    await auth.deleteSession(signedIn.tokenHash);
    expect(await auth.getSession(signedIn.tokenHash)).toBeNull();
  });

  it("consumes a nonce atomically and refuses expired nonces", async () => {
    const nonce = randomUUID();
    await auth.createNonce(TRADER, NOW, new Date(NOW.getTime() + 60_000), nonce);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => auth.consumeNonce(nonce, NOW)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await auth.getNonce(nonce))?.usedAt).toEqual(NOW);

    const expired = randomUUID();
    await auth.createNonce(TRADER, NOW, new Date(NOW.getTime() + 1), expired);
    expect(await auth.consumeNonce(expired, new Date(NOW.getTime() + 2))).toBe(false);
  });

  it("round-trips quote bigints and consumes a quote only once under concurrency", async () => {
    const record = quoteRecord();
    await quotes.save(record);
    expect(await quotes.get(record.id)).toEqual(record);
    const results = await Promise.all(Array.from({ length: 10 }, () => quotes.consume(record.id)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await quotes.get(record.id))?.used).toBe(true);
    expect(await quotes.consume(record.id)).toBe(false);
  });

  it("persists intent numeric evidence and enforces one intent per quote", async () => {
    const first = intent("intent-1", "quote-1");
    const second = intent("intent-2", "quote-2");
    await intents.insert(first);
    await intents.insert(second);
    await intents.insert(intent("intent-other", "quote-other", OTHER));
    expect((await intents.list(TRADER)).map((row) => row.id).sort()).toEqual([
      "intent-1",
      "intent-2",
    ]);
    await expect(intents.insert(intent("duplicate", "quote-1"))).rejects.toBeTruthy();

    await intents.markStatus("intent-1", "verified", {
      txHash: `0x${"cd".repeat(32)}`,
      blockNumber: 123n,
      blockHash: `0x${"ef".repeat(32)}`,
    });
    expect(await intents.get("intent-1")).toMatchObject({
      status: "verified",
      txHash: `0x${"cd".repeat(32)}`,
      blockNumber: "123",
      blockHash: `0x${"ef".repeat(32)}`,
      amountIn: "1000000",
      deadline: String(NOW_SECONDS + 60),
    });
  });
});
