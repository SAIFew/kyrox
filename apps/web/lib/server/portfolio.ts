import { and, desc, eq, isNotNull, lte } from "drizzle-orm";

import { TESTNET_ASSETS, fromBaseUnits, isSupportedStockDecimals, type Address } from "@kyrox/core";
import { appDatabase } from "./database.js";
import { priceObservations } from "@kyrox/db";
import { DrizzleObservationStore } from "@kyrox/price";

import type { AllocationSlice, PortfolioPayload, PortfolioPosition } from "../market-types.js";
import {
  settlementToken,
  assetAddress,
  exchangeAddress,
  EnvironmentError,
  type RuntimeEnvironment,
} from "./env.js";
import { createChainClient, ERC20_ABI, EXCHANGE_VIEWS_ABI, type ChainClient } from "./chain.js";
import { isObservationFresh } from "./freshness.js";

export interface PortfolioLine {
  readonly symbol: string;
  readonly kind: "settlement" | "stock";
  readonly decimals: number;
  readonly amount: string;
  readonly priceUsdc: string | null;
  readonly valueUsdc: string | null;
  readonly valueUsdcUnits: string | null;
  readonly change24hPct: number | null;
  readonly change24hUsdc: string | null;
  readonly stale: boolean;
  readonly simulated: boolean;
}

export interface Portfolio {
  readonly owner: Address;
  readonly simulated: boolean;
  readonly settlement: PortfolioLine;
  readonly positions: readonly PortfolioLine[];
  readonly totalUsdc: string | null;
  readonly totalUsdcUnits: bigint | null;
  readonly change24hUsdc: string | null;
  readonly change24hPct: number | null;
  readonly stale: boolean;
  readonly asOf: number;
}

const ACCENTS: Readonly<Record<string, string>> = {
  tAAPL: "#a6b4c8",
  tNVDA: "#7cf0c1",
  tMSFT: "#7aa7ff",
  tGOOGL: "#f4c15d",
  tAMZN: "#f59e6b",
  tTSLA: "#ff7b7b",
  tMETA: "#8b9dff",
};
const ZERO_FEED = "0x0000000000000000000000000000000000000000";
const SECONDS_PER_DAY = 86_400;

const usdc = (value: bigint): string => fromBaseUnits(value, 6);

export function usdcHuman(value: bigint): string {
  const raw = usdc(value);
  const [whole, fraction = ""] = raw.split(".");
  return `${whole}.${fraction.padEnd(6, "0")}`;
}

function signedUsdc(value: bigint): string {
  return value < 0n ? `-${usdc(-value)}` : usdc(value);
}

function percentageChange(current: bigint, previous: bigint): number | null {
  if (previous <= 0n) return null;
  const value = Number(((current - previous) * 10_000n) / previous) / 100;
  return Number.isFinite(value) ? value : null;
}

async function balanceOf(client: ChainClient, token: Address, owner: Address): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  });
}

export function valueUnits(amount: bigint, decimals: number, price: bigint | null): bigint | null {
  if (price === null) return null;
  return (amount * price) / 10n ** BigInt(decimals);
}

async function previousPrice(
  db: ReturnType<typeof appDatabase>["db"],
  symbol: string,
  cutoffSeconds: number,
): Promise<bigint | null> {
  const rows = await db
    .select({ price: priceObservations.referencePriceUsdcPerWholeToken })
    .from(priceObservations)
    .where(
      and(
        eq(priceObservations.assetSymbol, symbol),
        eq(priceObservations.status, "valid"),
        lte(priceObservations.sourceUpdatedAt, new Date(cutoffSeconds * 1_000)),
        isNotNull(priceObservations.referencePriceUsdcPerWholeToken),
      ),
    )
    .orderBy(desc(priceObservations.sourceUpdatedAt), desc(priceObservations.observedAt))
    .limit(1);
  const price = rows[0]?.price;
  return price === null || price === undefined ? null : BigInt(price);
}

export async function portfolioFor(env: RuntimeEnvironment, owner: Address): Promise<Portfolio> {
  const db = appDatabase(env.databaseUrl);
  const store = new DrizzleObservationStore(db.db);
  const client = createChainClient(env);
  const now = Math.floor(Date.now() / 1_000);
  const cutoff = now - SECONDS_PER_DAY;
  const positions: PortfolioLine[] = [];
  let total = 0n;
  let totalChange = 0n;
  let stale = false;
  let changeKnown = true;

  const settlementAmount = await balanceOf(client, settlementToken(env), owner);
  const settlementDecimals = await client.readContract({
    address: settlementToken(env),
    abi: ERC20_ABI,
    functionName: "decimals",
  });
  if (settlementDecimals !== 6) {
    throw new EnvironmentError("The configured settlement token must use 6 decimals.");
  }

  for (const definition of TESTNET_ASSETS) {
    const symbol = definition.symbol;
    const token = assetAddress(env, symbol);
    const settings = await client.readContract({
      address: exchangeAddress(env),
      abi: EXCHANGE_VIEWS_ABI,
      functionName: "assetSettings",
      args: [token],
    });
    const [listed, stockDecimals, maxSourceAgeSeconds] = settings;
    if (!isSupportedStockDecimals(stockDecimals)) {
      throw new EnvironmentError(`${symbol} reports unsupported decimals ${stockDecimals}.`);
    }
    const decimals = stockDecimals;
    const latest = await store.latestValidObservation(symbol);
    const manifestMaxAge = env.manifest.assets[symbol]?.maxSourceAgeSeconds;
    const maxAge = maxSourceAgeSeconds > 0 ? maxSourceAgeSeconds : manifestMaxAge;
    const fresh =
      listed &&
      latest !== null &&
      latest.referencePriceUsdcPerWholeToken !== null &&
      latest.referencePriceUsdcPerWholeToken > 0n &&
      latest.sourceUpdatedAt <= now &&
      isObservationFresh(now, latest.sourceUpdatedAt, maxAge);
    const price = fresh ? (latest?.referencePriceUsdcPerWholeToken ?? null) : null;
    const amount = await balanceOf(client, token, owner);
    const units = valueUnits(amount, decimals, price);
    if (units !== null) total += units;

    const priorPrice = price === null ? null : await previousPrice(db.db, symbol, cutoff);
    const priorUnits = priorPrice === null ? null : valueUnits(amount, decimals, priorPrice);
    const changeUnits = units === null || priorUnits === null ? null : units - priorUnits;
    const change = changeUnits === null ? null : signedUsdc(changeUnits);
    const changePct =
      price === null || priorPrice === null ? null : percentageChange(price, priorPrice);
    if (units === null || change === null || changePct === null) changeKnown = false;
    if (changeUnits !== null) totalChange += changeUnits;
    if (price === null) stale = true;
    positions.push({
      symbol,
      kind: "stock",
      decimals,
      amount: fromBaseUnits(amount, decimals),
      priceUsdc: price === null ? null : usdc(price),
      valueUsdc: units === null ? null : usdc(units),
      valueUsdcUnits: units === null ? null : units.toString(),
      change24hPct: changePct,
      change24hUsdc: change,
      stale: price === null,
      simulated: env.mode === "local-anvil" || latest?.feedAddress === ZERO_FEED,
    });
  }

  total += settlementAmount;
  const settlement: PortfolioLine = {
    symbol: "tUSDC",
    kind: "settlement",
    decimals: settlementDecimals,
    amount: usdc(settlementAmount),
    priceUsdc: "1",
    valueUsdc: usdc(settlementAmount),
    valueUsdcUnits: settlementAmount.toString(),
    change24hPct: 0,
    change24hUsdc: "0",
    stale: false,
    simulated: env.mode === "local-anvil",
  };
  const previousTotal = total - totalChange;
  const totalChangeUsdc = stale || !changeKnown ? null : signedUsdc(totalChange);

  return {
    owner,
    simulated: env.mode === "local-anvil",
    settlement,
    positions,
    totalUsdc: stale ? null : usdc(total),
    totalUsdcUnits: stale ? null : total,
    change24hUsdc: totalChangeUsdc,
    change24hPct:
      totalChangeUsdc === null || previousTotal <= 0n
        ? null
        : percentageChange(total, previousTotal),
    stale,
    asOf: now,
  };
}

/** Canonical client-safe adapter for the live portfolio domain object. */
export function portfolioPayload(env: RuntimeEnvironment, portfolio: Portfolio): PortfolioPayload {
  const positions: PortfolioPosition[] = portfolio.positions.map((line) => ({
    symbol: line.symbol,
    name: TESTNET_ASSETS.find((asset) => asset.symbol === line.symbol)?.name ?? line.symbol,
    decimals: line.decimals,
    amount: line.amount,
    priceUsdc: line.priceUsdc,
    valueUsdc: line.valueUsdc,
    change24hPct: line.change24hPct,
    change24hUsdc: line.change24hUsdc,
    stale: line.stale,
    simulated: line.simulated,
  }));

  const allocation: AllocationSlice[] = [];
  const total = portfolio.totalUsdcUnits;
  if (total !== null) {
    for (const line of portfolio.positions) {
      if (line.valueUsdcUnits === null) continue;
      const value = BigInt(line.valueUsdcUnits);
      if (value <= 0n) continue;
      allocation.push({
        symbol: line.symbol,
        name: TESTNET_ASSETS.find((asset) => asset.symbol === line.symbol)?.name ?? line.symbol,
        valueUsdc: usdc(value),
        sharePct: total === 0n ? 0 : Number((value * 10_000n) / total) / 100,
        accent: ACCENTS[line.symbol] ?? "#7cf0c1",
      });
    }
    const cash = BigInt(portfolio.settlement.valueUsdcUnits ?? "0");
    if (cash > 0n) {
      allocation.push({
        symbol: portfolio.settlement.symbol,
        name: "Settlement cash",
        valueUsdc: usdc(cash),
        sharePct: total === 0n ? 0 : Number((cash * 10_000n) / total) / 100,
        accent: "#8aa4ff",
      });
    }
  }

  return {
    address: portfolio.owner,
    mode: "live",
    simulated: env.mode === "local-anvil",
    cash: {
      symbol: portfolio.settlement.symbol,
      amount: portfolio.settlement.amount,
      valueUsdc: portfolio.settlement.valueUsdc ?? "0",
    },
    positions,
    allocation,
    totalUsdc: portfolio.totalUsdc,
    change24hUsdc: portfolio.change24hUsdc,
    change24hPct: portfolio.change24hPct,
    stale: portfolio.stale,
    asOf: portfolio.asOf,
  };
}
