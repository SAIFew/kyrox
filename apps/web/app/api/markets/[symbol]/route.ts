import { NextResponse } from "next/server";

import { fromBaseUnits } from "@kyrox/core";

import { demoAsset, demoDetail, isChartRange } from "@/lib/demo/market";
import { isDemoMode } from "@/lib/demo/mode";
import { environmentInfo } from "@/lib/server/session";
import { loadEnvironment } from "@/lib/server/env";
import { createChainClient, EXCHANGE_VIEWS_ABI } from "@/lib/server/chain";
import { DrizzleObservationStore } from "@kyrox/price";
import { createDatabase } from "@kyrox/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await context.params;
  const rangeParam = new URL(request.url).searchParams.get("range");
  const range = isChartRange(rangeParam) ? rangeParam : "1W";
  const now = Math.floor(Date.now() / 1_000);

  if (isDemoMode()) {
    const detail = demoDetail(symbol, range, now);
    if (detail === null) {
      return NextResponse.json({ error: "Unknown market." }, { status: 404 });
    }
    return NextResponse.json({ environment: environmentInfo(), market: detail });
  }

  const asset = demoAsset(symbol);
  if (asset === null) return NextResponse.json({ error: "Unknown market." }, { status: 404 });
  const env = loadEnvironment();
  const db = createDatabase(env.databaseUrl);
  try {
    const observation = await new DrizzleObservationStore(db.db).latestValidObservation(symbol);
    const settings = env.manifest.assets[symbol];
    if (settings === undefined) {
      return NextResponse.json({ error: "Asset is not configured." }, { status: 404 });
    }
    const price =
      observation?.referencePriceUsdcPerWholeToken === null ||
      observation?.referencePriceUsdcPerWholeToken === undefined
        ? null
        : observation.referencePriceUsdcPerWholeToken;
    const maxAge = settings.maxSourceAgeSeconds ?? 3_600;
    const fresh =
      observation !== null &&
      observation !== undefined &&
      now - observation.sourceUpdatedAt <= maxAge;
    const client = createChainClient(env);
    const paused = await client
      .readContract({
        address: env.manifest.contracts["KyroxExchange"]?.address as `0x${string}`,
        abi: EXCHANGE_VIEWS_ABI,
        functionName: "paused",
      })
      .catch(() => true);
    return NextResponse.json({
      environment: { ...environmentInfo(), simulated: env.mode === "local-anvil" },
      market: {
        asset,
        symbol,
        priceUsdc: price === null ? null : fromBaseUnits(price, 6),
        change24hPct: null,
        high24hUsdc: null,
        low24hUsdc: null,
        volume24hUsdc: null,
        sourceUpdatedAt: observation?.sourceUpdatedAt ?? null,
        observedAt: observation?.observedAt ?? null,
        fresh,
        simulated: env.mode === "local-anvil",
        history: [],
        range,
        highRangeUsdc: null,
        lowRangeUsdc: null,
        changeRangePct: null,
        paused,
      },
    });
  } finally {
    await db.pool.end();
  }
}
