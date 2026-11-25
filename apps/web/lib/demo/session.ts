import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { inflateRawSync, deflateRawSync } from "node:zlib";
import { cookies } from "next/headers";

import { fromBaseUnits, toBaseUnits } from "@kyrox/core";

import type {
  ActivityItem,
  AllocationSlice,
  PortfolioPayload,
  PortfolioPosition,
} from "../market-types.js";
import { DEMO_ASSETS, demoAsset, demoSnapshot, priceAt } from "./market.js";

export { isDemoMode } from "./mode.js";

export const DEMO_COOKIE = "kyrox_demo_session";
export const DEMO_NONCE_COOKIE = "kyrox_demo_nonce";
export const DEMO_SESSION_TTL_SECONDS = 7 * 24 * 3_600;
const MAX_DEMO_FILLS = 12;
const MAX_CONSUMED_QUOTES = 128;
const MIN_DEMO_SECRET_LENGTH = 32;
const MAX_DEMO_TOKEN_BYTES = 32 * 1024;
const MAX_DEMO_PAYLOAD_BYTES = 64 * 1024;
const DEV_ONLY_DEMO_SECRET = "kyrox-demo-development-only-secret-change-me-before-production";

/** Rough entropy screen; length alone does not make a production secret safe. */
export function isHighEntropyDemoSecret(secret: string): boolean {
  if (secret.length < MIN_DEMO_SECRET_LENGTH) return false;
  const counts = new Map<string, number>();
  for (const character of secret) counts.set(character, (counts.get(character) ?? 0) + 1);
  if (counts.size < 12) return false;
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / secret.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy >= 3.5;
}

/**
 * Dedicated secret wins, but a blank dedicated value falls back to AUTH_SECRET.
 * Production never pads or invents a secret. Outside production only, a clearly
 * labelled deterministic development fallback keeps the preview easy to run.
 */
export function demoSecret(): string {
  const dedicated = process.env["KYROX_DEMO_SECRET"]?.trim() ?? "";
  const auth = process.env["AUTH_SECRET"]?.trim() ?? "";
  const configured = dedicated.length > 0 ? dedicated : auth;
  if (configured.length > 0) {
    if (
      configured.length < MIN_DEMO_SECRET_LENGTH ||
      configured === DEV_ONLY_DEMO_SECRET ||
      !isHighEntropyDemoSecret(configured)
    ) {
      throw new Error("Demo secret must be high-entropy and at least 32 characters.");
    }
    return configured;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("KYROX_DEMO_SECRET or AUTH_SECRET is required in production.");
  }
  return DEV_ONLY_DEMO_SECRET;
}

export function seal(payload: unknown): string {
  const json = JSON.stringify(payload);
  const raw = Buffer.from(json).toString("base64url");
  const compressed = deflateRawSync(Buffer.from(json)).toString("base64url");
  // Prefixes distinguish compressed/uncompressed bodies while remaining
  // compatible with legacy unsigned-format (but still HMAC-verified) tokens.
  const body = compressed.length + 1 < raw.length ? `z${compressed}` : `u${raw}`;
  const signature = createHmac("sha256", demoSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function unseal<T>(token: string | undefined): T | null {
  if (token === undefined || token.length === 0 || token.length > MAX_DEMO_TOKEN_BYTES) return null;
  const [body, signature, extra] = token.split(".");
  if (body === undefined || signature === undefined || extra !== undefined) return null;
  const expected = createHmac("sha256", demoSecret()).update(body).digest("base64url");
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
  try {
    let json: string;
    if (body.startsWith("z")) {
      const inflated = inflateRawSync(Buffer.from(body.slice(1), "base64url"), {
        maxOutputLength: MAX_DEMO_PAYLOAD_BYTES,
      });
      json = inflated.toString("utf8");
    } else {
      const encoded = body.startsWith("u") ? body.slice(1) : body;
      json = Buffer.from(encoded, "base64url").toString("utf8");
      if (Buffer.byteLength(json) > MAX_DEMO_PAYLOAD_BYTES) return null;
    }
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export interface DemoFill {
  readonly id: string;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly amountIn: string;
  readonly amountOut: string;
  readonly priceUsdc: string;
  readonly createdAt: string;
  readonly reference: string;
  /** Simulated average cost per whole token (6-decimal USDC) after this fill. */
  readonly avgCostUsdc?: string;
  /** Simulated realised P&L on a sell, in 6-decimal USDC (may be negative). */
  readonly realizedPnlUsdc?: string;
}

/** Simulated weighted-average cost basis for one stock position. */
export interface DemoCostBasis {
  /** Stock base units covered by this basis. */
  readonly amount: string;
  /** Total 6-decimal USDC paid for those units. */
  readonly costUsdc: string;
}

export interface DemoLedger {
  readonly balances: Readonly<Record<string, string>>;
  /** Display-only recent fills; never used as the complete accounting history. */
  readonly activity: readonly DemoFill[];
  /** Untruncated USDC notional by UTC day: buy input plus sell output. */
  readonly dailyNotionalUsdc?: Readonly<Record<string, string>>;
  /** Active consumed quote ids and their expiry seconds. */
  readonly consumedQuoteIds?: Readonly<Record<string, number>>;
  /** Simulated cost basis by stock symbol; never presented as real tax cost. */
  readonly costBasis?: Readonly<Record<string, DemoCostBasis>>;
}

export interface DemoFeedback {
  readonly topic: string;
  readonly message: string;
  readonly createdAt: string;
}

export interface DemoGrowth {
  readonly questions: number;
  readonly feedback: readonly DemoFeedback[];
  readonly referredBy: string | null;
}

export interface DemoSession {
  readonly address: `0x${string}`;
  readonly expiresAt: number;
  readonly demo: true;
  readonly ledger: DemoLedger;
  readonly growth?: DemoGrowth;
}

interface StoredDemoSession {
  v: 2;
  a: string;
  exp: number;
  b: Record<string, string>;
  h: DemoFill[];
  d?: Record<string, string>;
  c?: Record<string, number>;
  /** Simulated cost basis: `{ a: stock base units, c: USDC cost }`. */
  k?: Record<string, { a: string; c: string }>;
  /** Simulated growth counters: questions, feedback, referral attribution. */
  g?: { q?: number; f?: Array<{ t: string; m: string; at: string }>; r?: string };
}

function defaultBalances(): Record<string, string> {
  return {
    tUSDC: toBaseUnits("25000", 6).toString(),
    tAAPL: toBaseUnits("12.5", 18).toString(),
    tNVDA: toBaseUnits("8", 18).toString(),
    tMSFT: toBaseUnits("3", 18).toString(),
    tGOOGL: toBaseUnits("10", 18).toString(),
    tAMZN: toBaseUnits("6", 18).toString(),
    tTSLA: toBaseUnits("4", 18).toString(),
    tMETA: toBaseUnits("2", 18).toString(),
  };
}

/**
 * Seed the scenario portfolio with plausible earlier purchase prices so the
 * demo can show average cost and P&L. These are simulated bookkeeping values,
 * not market history, tax lots, or evidence of a real purchase.
 */
function defaultCostBasis(): Record<string, DemoCostBasis> {
  return {
    tAAPL: {
      amount: toBaseUnits("12.5", 18).toString(),
      costUsdc: toBaseUnits("3281.25", 6).toString(),
    },
    tTSLA: { amount: toBaseUnits("4", 18).toString(), costUsdc: toBaseUnits("1792", 6).toString() },
    tNVDA: {
      amount: toBaseUnits("8", 18).toString(),
      costUsdc: toBaseUnits("1473.6", 6).toString(),
    },
    tMSFT: { amount: toBaseUnits("3", 18).toString(), costUsdc: toBaseUnits("1275", 6).toString() },
    tGOOGL: {
      amount: toBaseUnits("10", 18).toString(),
      costUsdc: toBaseUnits("1880", 6).toString(),
    },
    tAMZN: { amount: toBaseUnits("6", 18).toString(), costUsdc: toBaseUnits("1290", 6).toString() },
    tMETA: { amount: toBaseUnits("2", 18).toString(), costUsdc: toBaseUnits("1200", 6).toString() },
  };
}

export function defaultDemoGrowth(): DemoGrowth {
  return { questions: 0, feedback: [], referredBy: null };
}

function sanitizeGrowth(value: unknown): DemoGrowth {
  if (value === null || typeof value !== "object") return defaultDemoGrowth();
  const source = value as { q?: unknown; f?: unknown; r?: unknown };
  const questions =
    typeof source.q === "number" && Number.isSafeInteger(source.q) && source.q >= 0
      ? Math.min(source.q, 100_000)
      : 0;
  const feedback: DemoFeedback[] = [];
  if (Array.isArray(source.f)) {
    for (const entry of source.f.slice(0, 20)) {
      if (entry === null || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      if (typeof row["t"] !== "string" || typeof row["m"] !== "string") continue;
      feedback.push({
        topic: row["t"].slice(0, 32),
        message: row["m"].slice(0, 2_000),
        createdAt:
          typeof row["at"] === "string" && !Number.isNaN(Date.parse(row["at"]))
            ? row["at"]
            : new Date().toISOString(),
      });
    }
  }
  const referredBy =
    typeof source.r === "string" && /^KX[0-9A-F]{6}$/.test(source.r.toUpperCase())
      ? source.r.toUpperCase()
      : null;
  return { questions, feedback, referredBy };
}

export function defaultDemoLedger(): DemoLedger {
  return {
    balances: defaultBalances(),
    activity: [],
    dailyNotionalUsdc: {},
    consumedQuoteIds: {},
    costBasis: defaultCostBasis(),
  };
}

function sanitizeAmount(value: unknown): string {
  if (typeof value !== "string" || !/^\d{1,78}$/.test(value)) return "0";
  try {
    return BigInt(value).toString();
  } catch {
    return "0";
  }
}

function sanitizeSignedAmount(value: unknown): string | null {
  if (typeof value !== "string" || !/^-?\d{1,78}$/.test(value)) return null;
  try {
    return BigInt(value).toString();
  } catch {
    return null;
  }
}

function utcDayKey(milliseconds: number): string {
  return String(Math.floor(milliseconds / 86_400_000));
}

function fillNotionalUsdc(fill: DemoFill): bigint {
  try {
    return BigInt(fill.side === "buy" ? fill.amountIn : fill.amountOut);
  } catch {
    return 0n;
  }
}

function sanitizeLedger(value: unknown): DemoLedger {
  const fallback = defaultDemoLedger();
  if (value === null || typeof value !== "object") return fallback;
  const source = value as { b?: unknown; h?: unknown; d?: unknown; c?: unknown; k?: unknown };
  const balancesIn =
    source.b !== null && typeof source.b === "object" ? (source.b as Record<string, unknown>) : {};
  const balances: Record<string, string> = {};
  for (const asset of DEMO_ASSETS) {
    balances[asset.symbol] = sanitizeAmount(
      balancesIn[asset.symbol] ?? fallback.balances[asset.symbol],
    );
  }
  balances["tUSDC"] = sanitizeAmount(balancesIn["tUSDC"] ?? fallback.balances["tUSDC"]);
  const activity = Array.isArray(source.h) ? (source.h as unknown[]).slice(0, MAX_DEMO_FILLS) : [];
  const fills: DemoFill[] = [];
  for (const entry of activity) {
    if (entry === null || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (typeof row["symbol"] !== "string" || !demoAsset(row["symbol"])) continue;
    if (row["side"] !== "buy" && row["side"] !== "sell") continue;
    const avgCostUsdc = sanitizeSignedAmount(row["avgCostUsdc"]);
    const realizedPnlUsdc = sanitizeSignedAmount(row["realizedPnlUsdc"]);
    fills.push({
      id: typeof row["id"] === "string" ? row["id"].slice(0, 64) : randomUUID(),
      symbol: row["symbol"],
      side: row["side"],
      amountIn: sanitizeAmount(row["amountIn"]),
      amountOut: sanitizeAmount(row["amountOut"]),
      priceUsdc: sanitizeAmount(row["priceUsdc"]),
      createdAt:
        typeof row["createdAt"] === "string" && !Number.isNaN(Date.parse(row["createdAt"]))
          ? row["createdAt"]
          : new Date().toISOString(),
      reference: typeof row["reference"] === "string" ? row["reference"].slice(0, 80) : "simulated",
      ...(avgCostUsdc !== null && BigInt(avgCostUsdc) > 0n ? { avgCostUsdc } : {}),
      ...(realizedPnlUsdc !== null ? { realizedPnlUsdc } : {}),
    });
  }

  const costBasis: Record<string, DemoCostBasis> = {};
  if (source.k !== null && typeof source.k === "object") {
    for (const [symbol, value] of Object.entries(source.k as Record<string, unknown>)) {
      if (!demoAsset(symbol) || value === null || typeof value !== "object") continue;
      const row = value as Record<string, unknown>;
      const amount = sanitizeAmount(row["a"]);
      const costUsdc = sanitizeAmount(row["c"]);
      if (BigInt(amount) > 0n && BigInt(costUsdc) > 0n) {
        costBasis[symbol] = { amount, costUsdc };
      }
    }
  }

  const dailyNotionalUsdc: Record<string, string> = {};
  if (source.d !== null && typeof source.d === "object") {
    for (const [day, amount] of Object.entries(source.d as Record<string, unknown>)) {
      if (/^\d+$/.test(day) && typeof amount === "string" && /^\d{1,78}$/.test(amount)) {
        dailyNotionalUsdc[day] = BigInt(amount).toString();
      }
    }
  }
  // The aggregate is authoritative and untruncated. Visible fills are merged in
  // as a lower bound so a malformed/older aggregate can never undercount them.
  const visibleByDay: Record<string, bigint> = {};
  for (const fill of fills) {
    const timestamp = Date.parse(fill.createdAt);
    if (!Number.isFinite(timestamp)) continue;
    const day = utcDayKey(timestamp);
    visibleByDay[day] = (visibleByDay[day] ?? 0n) + fillNotionalUsdc(fill);
  }
  for (const [day, visible] of Object.entries(visibleByDay)) {
    const stored = BigInt(dailyNotionalUsdc[day] ?? "0");
    if (visible > stored) dailyNotionalUsdc[day] = visible.toString();
  }

  const nowSeconds = Math.floor(Date.now() / 1_000);
  const consumedQuoteIds: Record<string, number> = {};
  if (source.c !== null && typeof source.c === "object") {
    for (const [id, expiresAt] of Object.entries(source.c as Record<string, unknown>)) {
      if (
        id.length > 0 &&
        id.length <= 64 &&
        typeof expiresAt === "number" &&
        Number.isInteger(expiresAt) &&
        expiresAt > nowSeconds
      ) {
        consumedQuoteIds[id] = expiresAt;
      }
    }
  }

  return { balances, activity: fills, dailyNotionalUsdc, consumedQuoteIds, costBasis };
}

export function decodeDemoSession(token: string | undefined): DemoSession | null {
  const stored = unseal<StoredDemoSession>(token);
  if (stored === null || stored.v !== 2) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(stored.a)) return null;
  if (!Number.isInteger(stored.exp) || stored.exp <= Math.floor(Date.now() / 1_000)) return null;
  return {
    address: stored.a as `0x${string}`,
    expiresAt: stored.exp,
    demo: true,
    ledger: sanitizeLedger({ b: stored.b, h: stored.h, d: stored.d, c: stored.c, k: stored.k }),
    growth: sanitizeGrowth(stored.g),
  };
}

export function encodeDemoSession(session: DemoSession): string {
  const stored: StoredDemoSession = {
    v: 2,
    a: session.address,
    exp: session.expiresAt,
    b: { ...session.ledger.balances },
    h: [...session.ledger.activity],
    d: { ...session.ledger.dailyNotionalUsdc },
    c: { ...session.ledger.consumedQuoteIds },
    k: Object.fromEntries(
      Object.entries(session.ledger.costBasis ?? {}).map(([symbol, basis]) => [
        symbol,
        { a: basis.amount, c: basis.costUsdc },
      ]),
    ),
    g: {
      q: session.growth?.questions ?? 0,
      f: (session.growth?.feedback ?? []).map((entry) => ({
        t: entry.topic,
        m: entry.message,
        at: entry.createdAt,
      })),
      ...(session.growth?.referredBy === null || session.growth?.referredBy === undefined
        ? {}
        : { r: session.growth.referredBy }),
    },
  };
  return seal(stored);
}

export async function readDemoSession(): Promise<DemoSession | null> {
  const store = await cookies();
  return decodeDemoSession(store.get(DEMO_COOKIE)?.value);
}

export async function writeDemoSession(session: DemoSession): Promise<void> {
  const store = await cookies();
  store.set(DEMO_COOKIE, encodeDemoSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.max(60, session.expiresAt - Math.floor(Date.now() / 1000)),
  });
}

export async function clearDemoSession(): Promise<void> {
  const store = await cookies();
  store.set(DEMO_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  store.set(DEMO_NONCE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export function newDemoAddress(): `0x${string}` {
  return `0x${randomBytes(20).toString("hex")}`;
}

export function withTrustedAddress(session: DemoSession, address: `0x${string}`): DemoSession {
  return {
    address,
    expiresAt: Math.floor(Date.now() / 1000) + DEMO_SESSION_TTL_SECONDS,
    demo: true,
    ledger: session.ledger,
    growth: session.growth ?? defaultDemoGrowth(),
  };
}

export function balanceOf(session: DemoSession, symbol: string): bigint {
  const raw = session.ledger.balances[symbol] ?? "0";
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

export function isDemoQuoteConsumed(
  session: DemoSession,
  quoteId: string,
  nowSeconds: number,
): boolean {
  const expiresAt = session.ledger.consumedQuoteIds?.[quoteId];
  return expiresAt !== undefined && expiresAt > nowSeconds;
}

function aggregateVisibleActivity(session: DemoSession): Record<string, string> {
  const aggregate: Record<string, string> = {};
  for (const fill of session.ledger.activity) {
    const timestamp = Date.parse(fill.createdAt);
    if (!Number.isFinite(timestamp)) continue;
    const day = utcDayKey(timestamp);
    aggregate[day] = (BigInt(aggregate[day] ?? "0") + fillNotionalUsdc(fill)).toString();
  }
  return aggregate;
}

export interface ApplyFillOptions {
  readonly nowMs?: number;
  readonly consumedQuoteId?: string;
  readonly quoteExpiresAt?: number;
}

export function applyFill(
  session: DemoSession,
  fill: Omit<DemoFill, "id" | "createdAt" | "reference" | "avgCostUsdc" | "realizedPnlUsdc">,
  options: ApplyFillOptions = {},
): { session: DemoSession; fill: DemoFill } {
  const asset = demoAsset(fill.symbol);
  if (asset === null) throw new Error("Unsupported simulated asset.");
  if (fill.side !== "buy" && fill.side !== "sell") throw new Error("Invalid trade side.");
  let amountIn: bigint;
  let amountOut: bigint;
  let price: bigint;
  try {
    amountIn = BigInt(fill.amountIn);
    amountOut = BigInt(fill.amountOut);
    price = BigInt(fill.priceUsdc);
  } catch {
    throw new Error("Simulated fill amounts must be integer base units.");
  }
  if (amountIn <= 0n || amountOut <= 0n || price <= 0n) {
    throw new Error("Simulated fill amounts must be positive.");
  }

  const balances = { ...session.ledger.balances };
  const symbolIn = fill.side === "buy" ? "tUSDC" : fill.symbol;
  const symbolOut = fill.side === "buy" ? fill.symbol : "tUSDC";
  if (balanceOf(session, symbolIn) < amountIn) throw new Error("Insufficient simulated balance.");
  balances[symbolIn] = (balanceOf(session, symbolIn) - amountIn).toString();
  balances[symbolOut] = (balanceOf(session, symbolOut) + amountOut).toString();

  const requestedMs = options.nowMs ?? Date.now();
  const lastCreatedAt = session.ledger.activity[0]?.createdAt;
  const lastMs = lastCreatedAt === undefined ? 0 : Date.parse(lastCreatedAt);
  const createdAtMs = Number.isFinite(requestedMs)
    ? Math.max(requestedMs, Number.isFinite(lastMs) ? lastMs : 0)
    : Date.now();

  // Simulated weighted-average cost basis. Buys add their USDC input; sells
  // release the proportional part of the basis they cover. This is display-only
  // scenario accounting, never a tax lot or a claim about a real purchase.
  const nextCostBasis: Record<string, DemoCostBasis> = {
    ...session.ledger.costBasis,
  };
  const previousBasis = nextCostBasis[fill.symbol];
  const previousAmount = previousBasis === undefined ? 0n : BigInt(previousBasis.amount);
  const previousCost = previousBasis === undefined ? 0n : BigInt(previousBasis.costUsdc);
  let basisAmount = previousAmount;
  let basisCost = previousCost;
  let realizedPnl: bigint | null = null;
  if (fill.side === "buy") {
    basisAmount += amountOut;
    basisCost += amountIn;
  } else if (previousAmount > 0n && previousCost > 0n) {
    const sold = amountIn > previousAmount ? previousAmount : amountIn;
    const costSold = (previousCost * sold) / previousAmount;
    basisAmount = previousAmount - sold;
    basisCost = previousCost - costSold;
    realizedPnl = amountOut - costSold;
  }
  if (basisAmount > 0n && basisCost > 0n) {
    nextCostBasis[fill.symbol] = {
      amount: basisAmount.toString(),
      costUsdc: basisCost.toString(),
    };
  } else {
    delete nextCostBasis[fill.symbol];
  }
  const avgCostUsdc =
    basisAmount > 0n && basisCost > 0n
      ? ((basisCost * 10n ** BigInt(asset.decimals)) / basisAmount).toString()
      : null;

  const created: DemoFill = {
    ...fill,
    id: randomUUID(),
    createdAt: new Date(createdAtMs).toISOString(),
    reference: `sim_${randomBytes(6).toString("hex")}`,
    ...(avgCostUsdc === null ? {} : { avgCostUsdc }),
    ...(realizedPnl === null ? {} : { realizedPnlUsdc: realizedPnl.toString() }),
  };

  const dailyNotionalUsdc: Record<string, string> = {
    ...session.ledger.dailyNotionalUsdc,
  };
  for (const [day, visible] of Object.entries(aggregateVisibleActivity(session))) {
    if (BigInt(visible) > BigInt(dailyNotionalUsdc[day] ?? "0")) {
      dailyNotionalUsdc[day] = visible;
    }
  }
  const day = utcDayKey(createdAtMs);
  dailyNotionalUsdc[day] = (
    BigInt(dailyNotionalUsdc[day] ?? "0") + (fill.side === "buy" ? amountIn : amountOut)
  ).toString();

  const nowSeconds = Math.floor(createdAtMs / 1_000);
  const consumedQuoteIds: Record<string, number> = {};
  for (const [id, expiresAt] of Object.entries(session.ledger.consumedQuoteIds ?? {})) {
    if (expiresAt > nowSeconds) consumedQuoteIds[id] = expiresAt;
  }
  if (options.consumedQuoteId !== undefined) {
    const quoteId = options.consumedQuoteId;
    if (consumedQuoteIds[quoteId] !== undefined)
      throw new Error("Simulated quote was already used.");
    if (Object.keys(consumedQuoteIds).length >= MAX_CONSUMED_QUOTES) {
      throw new Error("Simulated quote replay cache is full; start a new demo session.");
    }
    if (options.quoteExpiresAt === undefined || options.quoteExpiresAt <= nowSeconds) {
      throw new Error("Simulated quote expired.");
    }
    consumedQuoteIds[quoteId] = options.quoteExpiresAt;
  }

  const next: DemoSession = {
    ...session,
    ledger: {
      balances,
      activity: [created, ...session.ledger.activity].slice(0, MAX_DEMO_FILLS),
      dailyNotionalUsdc,
      consumedQuoteIds,
      costBasis: nextCostBasis,
    },
  };
  return { session: next, fill: created };
}

export function dailySpentUsdc(session: DemoSession, now = Date.now()): bigint {
  const day = utcDayKey(now);
  const stored = session.ledger.dailyNotionalUsdc?.[day];
  if (stored !== undefined) return BigInt(stored);
  // Compatibility for programmatically constructed ledgers. Decoded v2 demo
  // sessions always carry the untruncated aggregate above.
  let total = 0n;
  for (const fill of session.ledger.activity) {
    const timestamp = Date.parse(fill.createdAt);
    if (Number.isFinite(timestamp) && utcDayKey(timestamp) === day) {
      total += fillNotionalUsdc(fill);
    }
  }
  return total;
}

function toUsdc(amount: bigint, price: bigint, decimals: number): bigint {
  return (amount * price) / 10n ** BigInt(decimals);
}

function signedUsdc(value: bigint): string {
  return value < 0n ? `-${fromBaseUnits(-value, 6)}` : fromBaseUnits(value, 6);
}

export function demoPortfolio(
  session: DemoSession,
  now = Math.floor(Date.now() / 1000),
): PortfolioPayload {
  const positions: PortfolioPosition[] = [];
  let stockValue = 0n;
  let stockChange = 0n;
  let stale = false;

  for (const asset of DEMO_ASSETS) {
    const amount = balanceOf(session, asset.symbol);
    const snapshot = demoSnapshot(asset.symbol, now);
    const price = BigInt(Math.round(Number(snapshot.priceUsdc) * 1_000_000));
    const previous = priceAt(asset.symbol, now - 86_400);
    const value = toUsdc(amount, price, asset.decimals);
    const previousValue = toUsdc(amount, previous, asset.decimals);
    const change = value - previousValue;
    stockValue += value;
    stockChange += change;

    const basis = session.ledger.costBasis?.[asset.symbol];
    const basisAmount = basis === undefined ? 0n : BigInt(basis.amount);
    const basisCost = basis === undefined ? 0n : BigInt(basis.costUsdc);
    const hasBasis = basisAmount > 0n && basisCost > 0n;
    const avgCost = hasBasis ? (basisCost * 10n ** BigInt(asset.decimals)) / basisAmount : null;
    const coveredCost = hasBasis ? (basisCost * amount) / basisAmount : null;
    const pnl = coveredCost === null ? null : value - coveredCost;
    const pnlPct =
      pnl === null || coveredCost === null || coveredCost === 0n
        ? null
        : Number((pnl * 10_000n) / coveredCost) / 100;

    positions.push({
      symbol: asset.symbol,
      name: asset.name,
      decimals: asset.decimals,
      amount: fromBaseUnits(amount, asset.decimals),
      priceUsdc: fromBaseUnits(price, 6),
      valueUsdc: fromBaseUnits(value, 6),
      change24hPct: snapshot.change24hPct,
      change24hUsdc: signedUsdc(change),
      stale: false,
      simulated: true,
      avgCostUsdc: avgCost === null ? null : fromBaseUnits(avgCost, 6),
      costBasisUsdc: coveredCost === null ? null : fromBaseUnits(coveredCost, 6),
      unrealizedPnlUsdc: pnl === null ? null : signedUsdc(pnl),
      unrealizedPnlPct: pnlPct,
    });
    if (snapshot.fresh !== true) stale = true;
  }

  const cashAmount = balanceOf(session, "tUSDC");
  const total = stockValue + cashAmount;
  const pct =
    total - stockChange === 0n ? null : (Number(stockChange) / Number(total - stockChange)) * 100;

  const slices: AllocationSlice[] = DEMO_ASSETS.map((asset) => {
    const amount = balanceOf(session, asset.symbol);
    const price = priceAt(asset.symbol, now);
    const value = toUsdc(amount, price, asset.decimals);
    return {
      symbol: asset.symbol,
      name: asset.name,
      valueUsdc: fromBaseUnits(value, 6),
      sharePct: total === 0n ? 0 : Number((value * 10_000n) / total) / 100,
      accent: asset.accent,
    };
  });
  slices.push({
    symbol: "tUSDC",
    name: "Settlement cash",
    valueUsdc: fromBaseUnits(cashAmount, 6),
    sharePct: total === 0n ? 0 : Number((cashAmount * 10_000n) / total) / 100,
    accent: "#8aa4ff",
  });

  return {
    address: session.address,
    mode: "demo",
    simulated: true,
    cash: {
      symbol: "tUSDC",
      amount: fromBaseUnits(cashAmount, 6),
      valueUsdc: fromBaseUnits(cashAmount, 6),
    },
    positions,
    allocation: slices.filter((slice) => Number(slice.valueUsdc) > 0),
    totalUsdc: fromBaseUnits(total, 6),
    change24hUsdc: signedUsdc(stockChange),
    change24hPct: pct === null ? null : Number(pct.toFixed(2)),
    stale,
    asOf: now,
  };
}

export function demoActivity(session: DemoSession): ActivityItem[] {
  return session.ledger.activity.map((fill) => {
    return {
      id: fill.id,
      symbol: fill.symbol,
      side: fill.side,
      amountIn: fill.amountIn,
      amountOut: fill.amountOut,
      priceUsdc: (() => {
        try {
          return fromBaseUnits(BigInt(fill.priceUsdc), 6);
        } catch {
          return null;
        }
      })(),
      status: "simulated" as const,
      txHash: null,
      simulated: true,
      createdAt: fill.createdAt,
    } satisfies ActivityItem;
  });
}
