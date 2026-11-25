import { fromBaseUnits } from "@kyrox/core";

import type {
  ChartPoint,
  ChartRange,
  MarketAsset,
  MarketDetail,
  MarketSnapshot,
} from "../market-types.js";

/**
 * Deterministic simulated reference market for the public preview.
 *
 * There is no oracle, no AMM, and no deployed exchange behind these numbers.
 * The curve is a pure function of time so every request, quote, and chart in a
 * given second agrees with every other one. Every payload is labelled
 * `simulated: true` and the UI repeats that label next to prices.
 */
export const DEMO_ASSETS: readonly MarketAsset[] = [
  {
    symbol: "tAAPL",
    name: "Test Apple",
    underlying: "AAPL",
    sector: "Technology",
    description:
      "Plain test instrument tracking the Apple reference curve. Simulated venue only; no real equity, dividend, or voting rights.",
    decimals: 18,
    accent: "#a6b4c8",
  },
  {
    symbol: "tNVDA",
    name: "Test NVIDIA",
    underlying: "NVDA",
    sector: "Semiconductors",
    description:
      "Plain test instrument tracking the NVIDIA reference curve, with a higher simulated volatility profile.",
    decimals: 18,
    accent: "#7cf0c1",
  },
  {
    symbol: "tMSFT",
    name: "Test Microsoft",
    underlying: "MSFT",
    sector: "Technology",
    description:
      "Plain test instrument tracking the Microsoft reference curve for the simulated venue.",
    decimals: 18,
    accent: "#7aa7ff",
  },
  {
    symbol: "tGOOGL",
    name: "Test Google",
    underlying: "GOOGL",
    sector: "Communication services",
    description:
      "Plain test instrument tracking the Alphabet reference curve for the simulated venue.",
    decimals: 18,
    accent: "#f4c15d",
  },
  {
    symbol: "tAMZN",
    name: "Test Amazon",
    underlying: "AMZN",
    sector: "Consumer discretionary",
    description:
      "Plain test instrument tracking the Amazon reference curve for the simulated venue.",
    decimals: 18,
    accent: "#f59e6b",
  },
  {
    symbol: "tTSLA",
    name: "Test Tesla",
    underlying: "TSLA",
    sector: "Automotive",
    description:
      "Plain test instrument tracking the Tesla reference curve, with a higher simulated volatility profile.",
    decimals: 18,
    accent: "#ff7b7b",
  },
  {
    symbol: "tMETA",
    name: "Test Meta",
    underlying: "META",
    sector: "Communication services",
    description: "Plain test instrument tracking the Meta reference curve for the simulated venue.",
    decimals: 18,
    accent: "#8b9dff",
  },
] as const;

interface Curve {
  readonly base: number;
  readonly phases: readonly [number, number, number];
  readonly trend: number;
  readonly volumeBase: number;
}

const CURVES: Readonly<Record<string, Curve>> = {
  tAAPL: { base: 287.42, phases: [0.6, 2.1, 4.4], trend: 0.00035, volumeBase: 18_400_000 },
  tNVDA: { base: 196.34, phases: [4.1, 3.3, 1.8], trend: 0.00068, volumeBase: 52_900_000 },
  tMSFT: { base: 431.5, phases: [1.3, 4.2, 2.6], trend: 0.00041, volumeBase: 21_600_000 },
  tGOOGL: { base: 191.2, phases: [3.2, 1.4, 5.7], trend: 0.00038, volumeBase: 24_800_000 },
  tAMZN: { base: 218.75, phases: [5.4, 2.8, 0.9], trend: 0.00047, volumeBase: 27_300_000 },
  tTSLA: { base: 431.18, phases: [2.7, 0.9, 5.2], trend: 0.00052, volumeBase: 31_700_000 },
  tMETA: { base: 612.4, phases: [1.9, 4.7, 3.1], trend: 0.00044, volumeBase: 16_900_000 },
};

const SECONDS_PER_DAY = 86_400;

function assetBySymbol(symbol: string): MarketAsset | null {
  return DEMO_ASSETS.find((asset) => asset.symbol === symbol) ?? null;
}

function numericHash(input: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/** Smooth multi-timescale curve plus deterministic microstructure jitter. */
function rawPrice(symbol: string, timestamp: number): number {
  const curve = CURVES[symbol] ?? CURVES["tAAPL"];
  if (curve === undefined) return 0;
  const [first, second, third] = curve.phases;
  const days = timestamp / SECONDS_PER_DAY;
  const wave =
    0.041 * Math.sin(days / 8.5 + first) +
    0.021 * Math.sin(days / 2.4 + second) +
    0.0085 * Math.sin(timestamp / (3_600 * 6.5) + third) +
    0.0022 * Math.sin(timestamp / 540 + first * 2);
  const drift = (days - 20_600) * curve.trend;
  const bucket = Math.floor(timestamp / 300);
  const jitterSeed = numericHash(`${symbol}:${bucket}`);
  const jitter = ((jitterSeed % 1_000) / 1_000 - 0.5) * 0.0026;
  return Math.max(0.01, curve.base * (1 + wave + drift + jitter));
}

/** Price of one whole token in 6-decimal USDC base units. */
export function priceAt(symbol: string, timestamp: number): bigint {
  const price = rawPrice(symbol, timestamp);
  return BigInt(Math.max(1, Math.round(price * 1_000_000)));
}

export function priceNumberAt(symbol: string, timestamp: number): number {
  return Number(priceAt(symbol, timestamp)) / 1_000_000;
}

function volumeAt(symbol: string, timestamp: number): bigint {
  const curve = CURVES[symbol] ?? CURVES["tAAPL"];
  if (curve === undefined) return 0n;
  const driftFactor = 1 + 0.24 * Math.sin(timestamp / SECONDS_PER_DAY / 3.1 + curve.phases[0]);
  const sessionFactor = 1 + 0.11 * Math.sin(timestamp / 3_600 / 2.6 + curve.phases[1]);
  return BigInt(Math.round(curve.volumeBase * driftFactor * sessionFactor) * 1_000_000);
}

/** Simulated source timestamps advance in fixed, nondecreasing five-minute steps. */
function sourceUpdatedAt(timestamp: number): number {
  return Math.floor(timestamp / 300) * 300;
}

function roundId(symbol: string, timestamp: number): number {
  const symbolOffset = numericHash(`${symbol}:round`) % 1_000_000;
  return 4_120_000 + symbolOffset + Math.floor(timestamp / 300);
}

export function demoSnapshot(symbol: string, now = Math.floor(Date.now() / 1000)): MarketSnapshot {
  const price = priceAt(symbol, now);
  const previous = priceAt(symbol, now - SECONDS_PER_DAY);
  const change = ((Number(price) - Number(previous)) / Number(previous)) * 100;

  let high = Number(price);
  let low = Number(price);
  for (let step = 0; step <= 24; step += 1) {
    const sample = Number(priceAt(symbol, now - step * 3_600));
    if (sample > high) high = sample;
    if (sample < low) low = sample;
  }

  return {
    symbol,
    priceUsdc: fromBaseUnits(price, 6),
    change24hPct: Number(change.toFixed(2)),
    high24hUsdc: fromBaseUnits(BigInt(Math.round(high)), 6),
    low24hUsdc: fromBaseUnits(BigInt(Math.round(low)), 6),
    volume24hUsdc: fromBaseUnits(volumeAt(symbol, now), 6),
    sourceUpdatedAt: sourceUpdatedAt(now),
    observedAt: now,
    fresh: true,
    simulated: true,
  };
}

export function demoMarketList(now = Math.floor(Date.now() / 1000)) {
  return DEMO_ASSETS.map((asset) => ({
    asset,
    snapshot: demoSnapshot(asset.symbol, now),
    sparkline: sparkline(asset.symbol, now),
  }));
}

const RANGE_STEPS: Readonly<Record<ChartRange, { seconds: number; count: number }>> = {
  "1D": { seconds: 600, count: 145 },
  "1W": { seconds: 3_600, count: 169 },
  "1M": { seconds: 14_400, count: 181 },
  "3M": { seconds: 43_200, count: 181 },
};

export function isChartRange(value: string | null | undefined): value is ChartRange {
  return value === "1D" || value === "1W" || value === "1M" || value === "3M";
}

export function demoHistory(
  symbol: string,
  range: ChartRange,
  now = Math.floor(Date.now() / 1000),
): ChartPoint[] {
  const config = RANGE_STEPS[range];
  const points: ChartPoint[] = [];
  for (let index = config.count - 1; index >= 0; index -= 1) {
    const timestamp = now - index * config.seconds;
    points.push({ t: timestamp, p: priceNumberAt(symbol, timestamp) });
  }
  return points;
}

function sparkline(symbol: string, now: number): number[] {
  return demoHistory(symbol, "1D", now)
    .filter((_point, index) => index % 8 === 0)
    .map((point) => point.p);
}

export function demoDetail(
  symbol: string,
  range: ChartRange = "1W",
  now = Math.floor(Date.now() / 1000),
): MarketDetail | null {
  const asset = assetBySymbol(symbol);
  if (asset === null) return null;
  const snapshot = demoSnapshot(symbol, now);
  const history = demoHistory(symbol, range, now);
  const first = history[0];
  const last = history[history.length - 1];
  const prices = history.map((point) => point.p);
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const change =
    first === undefined || last === undefined || first.p === 0
      ? 0
      : ((last.p - first.p) / first.p) * 100;

  return {
    ...snapshot,
    asset,
    history,
    range,
    highRangeUsdc: high.toFixed(2),
    lowRangeUsdc: low.toFixed(2),
    changeRangePct: Number(change.toFixed(2)),
  };
}

export function demoAsset(symbol: string): MarketAsset | null {
  return assetBySymbol(symbol);
}

export function demoRound(symbol: string, now: number): bigint {
  return BigInt(roundId(symbol, now));
}

/** The simulated oracle timestamp and price are consistent for any request. */
export function demoObservation(symbol: string, now: number) {
  return {
    assetSymbol: symbol,
    priceUsdcPerWholeToken: priceAt(symbol, now),
    sourceRoundId: demoRound(symbol, now),
    sourceUpdatedAt: sourceUpdatedAt(now),
    observedAt: now,
    sourceChainId: 84_532,
    feedAddress: null,
    sourceKind: "simulated" as const,
  };
}
