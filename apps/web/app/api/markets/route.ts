import { TESTNET_ASSETS, fromBaseUnits } from "@kyrox/core";

import { demoMarketList } from "@/lib/demo/market";
import { isDemoMode } from "@/lib/demo/mode";
import { assetAddress } from "@/lib/server/env";
import { isObservationFresh } from "@/lib/server/freshness";
import { environment, observationStore } from "@/lib/server/store-singleton";
import { environmentInfo } from "@/lib/server/session";
import { clientIp, error, json, rateLimit, routeError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const now = Math.floor(Date.now() / 1_000);
    if (isDemoMode()) {
      return json({ environment: environmentInfo(), asOf: now, markets: demoMarketList(now) });
    }
    if (!rateLimit(`markets:${clientIp(req)}`, 60)) {
      return error("Too many market requests.", 429, "rate_limited");
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
          fresh:
            observation !== null &&
            observation.sourceUpdatedAt <= now &&
            isObservationFresh(now, observation.sourceUpdatedAt, maxAge),
          simulated:
            env.mode === "local-anvil" ||
            observation?.feedAddress === "0x0000000000000000000000000000000000000000",
          stockToken: assetAddress(env, definition.symbol),
        },
        sparkline: [],
      });
    }
    return json({ environment: environmentInfo(env), asOf: now, markets });
  } catch (err) {
    return routeError(err, "markets_unavailable");
  }
}
