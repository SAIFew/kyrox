import { TESTNET_ASSETS, fromBaseUnits } from "@kyrox/core";

import { environment, observationStore } from "@/lib/server/store-singleton";
import { assetAddress, exchangeAddress, settlementToken } from "@/lib/server/env";
import { isObservationFresh } from "@/lib/server/freshness";
import { logEvent } from "@/lib/server/observability";
import { error, json } from "@/lib/server/http";

export async function GET() {
  try {
    const env = environment();
    const now = Math.floor(Date.now() / 1000);
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
    });
  } catch (err) {
    await logEvent("error", "assets_api", err instanceof Error ? err.message : "unavailable");
    return error(err instanceof Error ? err.message : "Assets unavailable.", 503, "unavailable");
  }
}
