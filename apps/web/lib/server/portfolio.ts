import { fromBaseUnits } from "@kyrox/core";
import type { Address } from "@kyrox/core";
import { createDatabase } from "@kyrox/db";
import { DrizzleObservationStore } from "@kyrox/price";

import { settlementToken, assetAddress, type RuntimeEnvironment } from "./env.js";
import { createChainClient, ERC20_ABI } from "./chain.js";

export interface PortfolioLine {
  readonly symbol: string;
  readonly kind: "settlement" | "stock";
  readonly decimals: number;
  readonly amount: string;
  readonly valueUsdc: string | null;
  readonly valueUsdcUnits: string | null;
  readonly stale: boolean;
}

export interface Portfolio {
  readonly owner: Address;
  readonly simulated: boolean;
  readonly settlement: PortfolioLine;
  readonly positions: readonly PortfolioLine[];
  readonly totalUsdc: string | null;
  readonly stale: boolean;
}

const usdc = (value: bigint): string => fromBaseUnits(value, 6);

export function usdcHuman(value: bigint): string {
  const raw = usdc(value);
  const [whole, fraction = ""] = raw.split(".");
  return `${whole}.${fraction.padEnd(6, "0")}`;
}

async function balanceOf(env: RuntimeEnvironment, token: Address, owner: Address): Promise<bigint> {
  const client = createChainClient(env);
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

export async function portfolioFor(env: RuntimeEnvironment, owner: Address): Promise<Portfolio> {
  const db = createDatabase(env.databaseUrl);
  try {
    const store = new DrizzleObservationStore(db.db);
    const settlementAmount = await balanceOf(env, settlementToken(env), owner);
    const symbols = ["tAAPL", "tTSLA", "tNVDA"] as const;
    const positions: PortfolioLine[] = [];
    let total = 0n;
    let stale = false;

    const now = Math.floor(Date.now() / 1000);
    for (const symbol of symbols) {
      const latest = await store.latestValidObservation(symbol);
      const maxAge = env.manifest.assets[symbol]?.maxSourceAgeSeconds ?? 3_600;
      const fresh = latest !== null && now - latest.sourceUpdatedAt <= maxAge;
      const price = fresh ? (latest?.referencePriceUsdcPerWholeToken ?? null) : null;
      if (price === null) stale = true;
      const amount = await balanceOf(env, assetAddress(env, symbol), owner);
      const units = valueUnits(amount, 18, price);
      if (units !== null) total += units;
      positions.push({
        symbol,
        kind: "stock",
        decimals: 18,
        amount: fromBaseUnits(amount, 18),
        valueUsdc: units === null ? null : usdc(units),
        valueUsdcUnits: units === null ? null : units.toString(),
        stale: price === null,
      });
    }

    const settlement: PortfolioLine = {
      symbol: "tUSDC",
      kind: "settlement",
      decimals: 6,
      amount: usdc(settlementAmount),
      valueUsdc: usdc(settlementAmount),
      valueUsdcUnits: settlementAmount.toString(),
      stale: false,
    };
    total += settlementAmount;

    return {
      owner,
      simulated: env.mode === "local-anvil",
      settlement,
      positions,
      totalUsdc: stale ? null : usdc(total),
      stale,
    };
  } finally {
    await db.pool.end();
  }
}
