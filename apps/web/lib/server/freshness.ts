import type { AssetFreshnessConfig } from "@kyrox/core";

/**
 * Bootstrap default for NEW testnet deployments and local manifests.
 *
 * Ten minutes is the MVP ceiling for a tradable testnet observation. Existing
 * deployments keep their on-chain/manifest bound; this constant is only used
 * where a fresh default must be supplied, never to override a missing bound at
 * read time.
 */
export const TESTNET_MAX_SOURCE_AGE_SECONDS = 600;

/** Default per-asset freshness for newly configured testnet deployments. */
export function defaultTestnetFreshnessConfig(assetSymbol: string): AssetFreshnessConfig {
  return {
    assetSymbol,
    maxSourceAgeSeconds: TESTNET_MAX_SOURCE_AGE_SECONDS,
    requireOpenMarket: false,
  };
}

/**
 * Freshness is judged only from the original source timestamp and the
 * per-asset manifest bound. A missing or non-positive bound fails closed rather
 * than falling back to a global default.
 */
export function isObservationFresh(
  nowSeconds: number,
  sourceUpdatedAt: number | null | undefined,
  maxSourceAgeSeconds: number | null | undefined,
): boolean {
  if (sourceUpdatedAt === null || sourceUpdatedAt === undefined) return false;
  if (
    !Number.isInteger(nowSeconds) ||
    nowSeconds <= 0 ||
    !Number.isInteger(sourceUpdatedAt) ||
    sourceUpdatedAt <= 0 ||
    sourceUpdatedAt > nowSeconds
  ) {
    return false;
  }
  if (
    maxSourceAgeSeconds === null ||
    maxSourceAgeSeconds === undefined ||
    !Number.isInteger(maxSourceAgeSeconds) ||
    maxSourceAgeSeconds <= 0
  ) {
    return false;
  }
  return nowSeconds - sourceUpdatedAt <= maxSourceAgeSeconds;
}
