import { fromBaseUnits } from "@kyrox/core";
import { DrizzleObservationStore } from "@kyrox/price";

import { demoAsset, demoDetail, isChartRange } from "@/lib/demo/market";
import { isDemoMode } from "@/lib/demo/mode";
import { appDatabase } from "@/lib/server/database";
import { environmentInfo } from "@/lib/server/session";
import { exchangeAddress, loadEnvironment } from "@/lib/server/env";
import { createChainClient, EXCHANGE_VIEWS_ABI } from "@/lib/server/chain";
import { isObservationFresh } from "@/lib/server/freshness";
import { clientIp, error, json, rateLimit, routeError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await context.params;
    const rangeParam = new URL(request.url).searchParams.get("range");
    const range = isChartRange(rangeParam) ? rangeParam : "1W";
    const now = Math.floor(Date.now() / 1_000);

    if (isDemoMode()) {
      const detail = demoDetail(symbol, range, now);
      if (detail === null) return error("Unknown market.", 404, "not_found");
      return json({ environment: environmentInfo(), market: detail });
    }
    if (!rateLimit(`market:${symbol}:${clientIp(request)}`, 60)) {
      return error("Too many market requests.", 429, "rate_limited");
    }

    const asset = demoAsset(symbol);
    if (asset === null) return error("Unknown market.", 404, "not_found");
    const env = loadEnvironment();
    const settings = env.manifest.assets[symbol];
    if (settings === undefined) return error("Asset is not configured.", 404, "not_found");
    const db = appDatabase(env.databaseUrl);
    const client = createChainClient(env);
    const [observation, chainSettings, paused] = await Promise.all([
      new DrizzleObservationStore(db.db).latestValidObservation(symbol),
      client.readContract({
        address: exchangeAddress(env),
        abi: EXCHANGE_VIEWS_ABI,
        functionName: "assetSettings",
        args: [settings.address],
      }),
      client.readContract({
        address: exchangeAddress(env),
        abi: EXCHANGE_VIEWS_ABI,
        functionName: "paused",
      }),
    ]);
    const [listed, stockDecimals, maxSourceAgeSeconds] = chainSettings;
    if (!listed) return error("Asset is not listed.", 404, "not_found");
    const price =
      observation?.referencePriceUsdcPerWholeToken === null ||
      observation?.referencePriceUsdcPerWholeToken === undefined
        ? null
        : observation.referencePriceUsdcPerWholeToken;
    const maxAge = maxSourceAgeSeconds > 0 ? maxSourceAgeSeconds : settings.maxSourceAgeSeconds;
    const fresh =
      observation !== null &&
      observation.sourceUpdatedAt <= now &&
      isObservationFresh(now, observation.sourceUpdatedAt, maxAge);
    return json({
      environment: environmentInfo(env),
      market: {
        asset: { ...asset, decimals: stockDecimals },
        symbol,
        priceUsdc: price === null ? null : fromBaseUnits(price, 6),
        change24hPct: null,
        high24hUsdc: null,
        low24hUsdc: null,
        volume24hUsdc: null,
        sourceUpdatedAt: observation?.sourceUpdatedAt ?? null,
        observedAt: observation?.observedAt ?? null,
        fresh,
        simulated:
          env.mode === "local-anvil" ||
          observation?.feedAddress === "0x0000000000000000000000000000000000000000",
        history: [],
        range,
        highRangeUsdc: null,
        lowRangeUsdc: null,
        changeRangePct: null,
        paused,
      },
    });
  } catch (err) {
    return routeError(err, "market_unavailable");
  }
}
