import { NextResponse } from "next/server";

import { TESTNET_ASSETS, fromBaseUnits } from "@kyrox/core";

import { demoMarketList } from "@/lib/demo/market";
import { isDemoMode } from "@/lib/demo/mode";
import { assetAddress } from "@/lib/server/env";
import { isObservationFresh } from "@/lib/server/freshness";
import { environment, observationStore } from "@/lib/server/store-singleton";
import { environmentInfo } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = Math.floor(Date.now() / 1_000);
  if (isDemoMode()) {
    return NextResponse.json({
      environment: environmentInfo(),
      asOf: now,
      markets: demoMarketList(now),
    });
  }

  const env = environment();
  const markets = [];
  for (const definition of TESTNET_ASSETS) {
    const observation = await observationStore().latestValidObservation(definition.symbol);
    const maxAge = env.manifest.assets[definition.symbol]?.maxSourceAgeSeconds ?? null;
    const price =
      observation?.referencePriceUsdcPerWholeToken === null ||
      observation?.referencePriceUsdcPerWholeToken === undefined
        ? null
        : fromBaseUnits(observation.referencePriceUsdcPerWholeToken, 6);
    markets.push({
      asset: {
        symbol: definition.symbol,
        name: definition.name,
        underlying: definition.symbol.slice(1),
        sector: "Tokenized equity",
        description: "Testnet reference-price instrument.",
        decimals: definition.stockDecimals,
        accent: "#7cf0c1",
      },
      snapshot: {
        symbol: definition.symbol,
        priceUsdc: price,
        change24hPct: null,
        high24hUsdc: null,
        low24hUsdc: null,
        volume24hUsdc: null,
        sourceUpdatedAt: observation?.sourceUpdatedAt ?? null,
        observedAt: observation?.observedAt ?? null,
        fresh: isObservationFresh(now, observation?.sourceUpdatedAt, maxAge),
        simulated: env.mode === "local-anvil",
        stockToken: assetAddress(env, definition.symbol),
      },
      sparkline: [],
    });
  }
  return NextResponse.json({ environment: environmentInfo(), asOf: now, markets });
}
