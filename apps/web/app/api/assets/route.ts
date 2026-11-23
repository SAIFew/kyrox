import { TESTNET_ASSETS, fromBaseUnits } from "@kyrox/core";

import { DEMO_ASSETS, demoSnapshot } from "@/lib/demo/market";
import { isDemoMode } from "@/lib/demo/mode";
import { environmentInfo } from "@/lib/server/session";
import { error, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * Backwards-compatible asset endpoint used by the earlier dashboard. The new
 * market endpoints are richer, but this shape remains stable for integrations.
 */
export async function GET() {
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
        maxSourceAgeSeconds: 3_600,
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

  const { environment, observationStore } = await import("@/lib/server/store-singleton");
  const { assetAddress, exchangeAddress, settlementToken } = await import("@/lib/server/env");
  const { isObservationFresh } = await import("@/lib/server/freshness");
  const { logEvent } = await import("@/lib/server/observability");

  try {
    const env = environment();
    const assets = TESTNET_ASSETS.map((asset) => ({
      ...asset,
      stockToken: assetAddress(env, asset.symbol),
    }));
    const enriched = await Promise.all(
      assets.map(async (asset) => {
        const observation = await observationStore().latestValidObservation(asset.symbol);
        const maxSourceAgeSeconds = env.manifest.assets[asset.symbol]?.maxSourceAgeSeconds ?? null;
        return {
          ...asset,
          priceUsdc:
            observation === null ||
            observation === undefined ||
            observation.referencePriceUsdcPerWholeToken === null
              ? null
              : fromBaseUnits(observation.referencePriceUsdcPerWholeToken, 6),
          sourceUpdatedAt: observation?.sourceUpdatedAt ?? null,
          observedAt: observation?.observedAt ?? null,
          maxSourceAgeSeconds,
          fresh: isObservationFresh(now, observation?.sourceUpdatedAt, maxSourceAgeSeconds),
          simulated:
            env.mode === "local-anvil" ||
            observation?.feedAddress === "0x0000000000000000000000000000000000000000",
        };
      }),
    );
    return json({
      assets: enriched,
      settlement: settlementToken(env),
      exchange: exchangeAddress(env),
      mode: env.mode,
      simulated: env.mode === "local-anvil",
      walletNetwork:
        env.mode === "local-anvil"
          ? { chainId: 84_532, rpcUrl: env.rpcUrl, name: "Base Sepolia (KYROX local)" }
          : null,
      environment: environmentInfo(),
    });
  } catch (err) {
    await logEvent("error", "assets_api", err instanceof Error ? err.message : "unavailable");
    return error(err instanceof Error ? err.message : "Assets unavailable.", 503, "unavailable");
  }
}
