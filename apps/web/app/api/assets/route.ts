import { TESTNET_ASSETS, fromBaseUnits } from "@kyrox/core";

import { DEMO_ASSETS, demoSnapshot } from "@/lib/demo/market";
import { isDemoMode } from "@/lib/demo/mode";
import { environmentInfo } from "@/lib/server/session";
import { clientIp, error, json, rateLimit, routeError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Backwards-compatible asset endpoint used by the earlier dashboard. */
export async function GET(req: Request) {
  try {
    const now = Math.floor(Date.now() / 1_000);
    if (isDemoMode()) {
      const assets = DEMO_ASSETS.map((asset) => {
        const snapshot = demoSnapshot(asset.symbol, now);
        return {
          symbol: asset.symbol,
          name: asset.name,
          stockToken: "0x0000000000000000000000000000000000000000",
          stockDecimals: asset.decimals,
          priceUsdc: snapshot.priceUsdc,
          sourceUpdatedAt: snapshot.sourceUpdatedAt,
          observedAt: snapshot.observedAt,
          maxSourceAgeSeconds: 600,
          fresh: true,
          simulated: true,
        };
      });
      return json({
        assets,
        settlement: "0x0000000000000000000000000000000000000000",
        exchange: "0x0000000000000000000000000000000000000000",
        mode: "demo",
        simulated: true,
        walletNetwork: null,
        environment: environmentInfo(),
        catalogue: TESTNET_ASSETS.map((entry) => entry.symbol),
      });
    }

    if (!rateLimit(`assets:${clientIp(req)}`, 60)) {
      return error("Too many asset requests.", 429, "rate_limited");
    }
    const { environment, observationStore } = await import("@/lib/server/store-singleton");
    const { assetAddress, exchangeAddress, settlementToken } = await import("@/lib/server/env");
    const { isObservationFresh } = await import("@/lib/server/freshness");
    const env = environment();
    const enriched = await Promise.all(
      TESTNET_ASSETS.map(async (asset) => {
        const observation = await observationStore().latestValidObservation(asset.symbol);
        const maxSourceAgeSeconds = env.manifest.assets[asset.symbol]?.maxSourceAgeSeconds ?? null;
        return {
          ...asset,
          stockToken: assetAddress(env, asset.symbol),
          priceUsdc:
            observation === null || observation.referencePriceUsdcPerWholeToken === null
              ? null
              : fromBaseUnits(observation.referencePriceUsdcPerWholeToken, 6),
          sourceUpdatedAt: observation?.sourceUpdatedAt ?? null,
          observedAt: observation?.observedAt ?? null,
          maxSourceAgeSeconds,
          fresh:
            observation !== null &&
            observation.sourceUpdatedAt <= now &&
            isObservationFresh(now, observation.sourceUpdatedAt, maxSourceAgeSeconds),
          simulated:
            env.mode === "local-anvil" ||
            observation?.feedAddress === "0x0000000000000000000000000000000000000000",
        };
      }),
    );
    const info = environmentInfo(env);
    return json({
      assets: enriched,
      settlement: settlementToken(env),
      exchange: exchangeAddress(env),
      mode: env.mode,
      simulated: env.mode === "local-anvil",
      walletNetwork:
        env.mode === "local-anvil"
          ? {
              chainId: env.manifest.chainId,
              rpcUrl: info.walletRpcUrl,
              name: info.walletNetworkName,
            }
          : null,
      environment: info,
      catalogue: TESTNET_ASSETS.map((entry) => entry.symbol),
    });
  } catch (err) {
    return routeError(err, "assets_unavailable");
  }
}
