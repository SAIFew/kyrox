import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
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
const PLACEHOLDER_SECRET = "kyrox-public-preview-secret-set-AUTH_SECRET-to-rotate";

/**
 * The public preview runs without a database or a deployed exchange. Explicit
 * opt-in wins; otherwise the preview activates whenever no database is
 * configured, so a fresh Vercel deployment is useful immediately.
 */
export function demoSecret(): string {
  const secret =
    process.env["KYROX_DEMO_SECRET"]?.trim() ??
    process.env["AUTH_SECRET"]?.trim() ??
    PLACEHOLDER_SECRET;
  return secret.length >= 32 ? secret : `${secret}${PLACEHOLDER_SECRET}`;
}

export function seal(payload: unknown): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", demoSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function unseal<T>(token: string | undefined): T | null {
  if (token === undefined || token.length === 0) return null;
  const [body, signature] = token.split(".");
  if (body === undefined || signature === undefined) return null;
  const expected = createHmac("sha256", demoSecret()).update(body).digest("base64url");
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
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
}

export interface DemoLedger {
  readonly balances: Readonly<Record<string, string>>;
  readonly activity: readonly DemoFill[];
}

export interface DemoSession {
  readonly address: `0x${string}`;
  readonly expiresAt: number;
  readonly demo: true;
  readonly ledger: DemoLedger;
}

interface StoredDemoSession {
  v: 1;
  a: string;
  exp: number;
  b: Record<string, string>;
  h: DemoFill[];
}

function defaultBalances(): Record<string, string> {
  return {
    tUSDC: toBaseUnits("25000", 6).toString(),
    tAAPL: toBaseUnits("12.5", 18).toString(),
    tTSLA: toBaseUnits("4", 18).toString(),
    tNVDA: toBaseUnits("8", 18).toString(),
  };
}

export function defaultDemoLedger(): DemoLedger {
  return { balances: defaultBalances(), activity: [] };
}

function sanitizeAmount(value: unknown): string {
  if (typeof value !== "string" || !/^\d{1,78}$/.test(value)) return "0";
  try {
    return BigInt(value).toString();
  } catch {
    return "0";
  }
}

function sanitizeLedger(value: unknown): DemoLedger {
  const fallback = defaultDemoLedger();
  if (value === null || typeof value !== "object") return fallback;
  const source = value as { b?: unknown; h?: unknown };
  const balancesIn =
    source.b !== null && typeof source.b === "object" ? (source.b as Record<string, unknown>) : {};
  const balances: Record<string, string> = {};
  for (const asset of DEMO_ASSETS) {
    balances[asset.symbol] = sanitizeAmount(
      balancesIn[asset.symbol] ?? fallback.balances[asset.symbol],
    );
  }
  balances["tUSDC"] = sanitizeAmount(balancesIn["tUSDC"]);
  const activity = Array.isArray(source.h) ? (source.h as unknown[]).slice(0, MAX_DEMO_FILLS) : [];
  const fills: DemoFill[] = [];
  for (const entry of activity) {
    if (entry === null || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (typeof row["symbol"] !== "string" || !demoAsset(row["symbol"])) continue;
    if (row["side"] !== "buy" && row["side"] !== "sell") continue;
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
    });
  }
  return { balances, activity: fills };
}

export function decodeDemoSession(token: string | undefined): DemoSession | null {
  const stored = unseal<StoredDemoSession>(token);
  if (stored === null) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(stored.a)) return null;
  if (!Number.isInteger(stored.exp) || stored.exp < Math.floor(Date.now() / 1000)) return null;
  return {
    address: stored.a as `0x${string}`,
    expiresAt: stored.exp,
    demo: true,
    ledger: sanitizeLedger({ b: stored.b, h: stored.h }),
  };
}

export function encodeDemoSession(session: DemoSession): string {
  const stored: StoredDemoSession = {
    v: 1,
    a: session.address,
    exp: session.expiresAt,
    b: { ...session.ledger.balances },
    h: [...session.ledger.activity],
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

export function applyFill(
  session: DemoSession,
  fill: Omit<DemoFill, "id" | "createdAt" | "reference">,
): { session: DemoSession; fill: DemoFill } {
  const balances = { ...session.ledger.balances };
  const amountIn = BigInt(fill.amountIn);
  const amountOut = BigInt(fill.amountOut);
  if (fill.side === "buy") {
    balances["tUSDC"] = (balanceOf(session, "tUSDC") - amountIn).toString();
    balances[fill.symbol] = (balanceOf(session, fill.symbol) + amountOut).toString();
  } else {
    balances[fill.symbol] = (balanceOf(session, fill.symbol) - amountIn).toString();
    balances["tUSDC"] = (balanceOf(session, "tUSDC") + amountOut).toString();
  }
  const created: DemoFill = {
    ...fill,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    reference: `sim_${randomBytes(6).toString("hex")}`,
  };
  const next: DemoSession = {
    ...session,
    ledger: { balances, activity: [created, ...session.ledger.activity].slice(0, MAX_DEMO_FILLS) },
  };
  return { session: next, fill: created };
}

export function dailySpentUsdc(session: DemoSession, now = Date.now()): bigint {
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  let total = 0n;
  for (const fill of session.ledger.activity) {
    if (fill.side !== "buy") continue;
    if (Date.parse(fill.createdAt) < dayStart.getTime()) continue;
    try {
      total += BigInt(fill.amountIn);
    } catch {
      // Ignore malformed legacy rows; the cookie is sanitized on read.
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
