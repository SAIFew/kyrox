import {
  CoreError,
  isSupportedStockDecimals,
  type Address,
  type AssetDefinition,
  type PriceObservation,
} from "@kyrox/core";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** The exact tuple returned by KyroxExchange.observation(stockToken). */
export interface CanonicalObservation {
  readonly priceUsdcPerWholeToken: bigint;
  readonly sourceRoundId: bigint;
  readonly sourceUpdatedAt: number;
  readonly publishedAt: number;
  readonly sourceChainId: number;
  readonly feedAddress: Address;
  readonly simulated: boolean;
}

export interface CanonicalObservationReader {
  readObservation(exchange: Address, stockToken: Address): Promise<CanonicalObservation>;
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function mismatch(message: string): never {
  throw new CoreError("QUOTE_MISMATCH", message);
}

/**
 * Fail closed unless the ingested row is exactly the observation currently
 * canonical for this exchange/token. The token is bound by the contract call
 * arguments and its decimals are independently read from ERC-20 metadata.
 */
export function assertCanonicalObservation(params: {
  readonly observation: PriceObservation;
  readonly canonical: CanonicalObservation;
  readonly asset: AssetDefinition;
  readonly stockDecimals: number;
  readonly nowSeconds: number;
}): void {
  const { observation, canonical, asset, stockDecimals, nowSeconds } = params;
  if (asset.stockToken === null) mismatch("Asset has no deployed stock token.");
  if (observation.assetSymbol !== asset.symbol) mismatch("Observation asset does not match.");
  if (!isSupportedStockDecimals(stockDecimals) || stockDecimals !== asset.stockDecimals) {
    mismatch("Canonical token decimals do not match the asset definition.");
  }
  if (!Number.isInteger(nowSeconds) || nowSeconds <= 0) {
    mismatch("Canonical observation validation clock is invalid.");
  }
  if (
    typeof canonical.priceUsdcPerWholeToken !== "bigint" ||
    canonical.priceUsdcPerWholeToken <= 0n ||
    typeof canonical.sourceRoundId !== "bigint" ||
    canonical.sourceRoundId <= 0n ||
    !Number.isInteger(canonical.sourceUpdatedAt) ||
    canonical.sourceUpdatedAt <= 0 ||
    !Number.isInteger(canonical.publishedAt) ||
    canonical.publishedAt <= 0 ||
    !Number.isInteger(canonical.sourceChainId) ||
    canonical.sourceChainId <= 0 ||
    typeof canonical.simulated !== "boolean" ||
    !/^0x[0-9a-fA-F]{40}$/.test(canonical.feedAddress)
  ) {
    mismatch("Exchange returned a malformed canonical observation.");
  }
  if (canonical.publishedAt > nowSeconds || canonical.sourceUpdatedAt > canonical.publishedAt) {
    mismatch("Exchange returned a future canonical observation timestamp.");
  }
  if (canonical.priceUsdcPerWholeToken !== observation.priceUsdcPerWholeToken) {
    mismatch("Ingested price does not match the exchange's canonical published price.");
  }
  if (canonical.sourceRoundId !== observation.sourceRoundId) {
    mismatch("Ingested round does not match the exchange's canonical published round.");
  }
  if (canonical.sourceUpdatedAt !== observation.sourceUpdatedAt) {
    mismatch("Ingested source timestamp does not match the exchange's canonical timestamp.");
  }
  if (canonical.sourceChainId !== observation.sourceChainId) {
    mismatch("Ingested source chain does not match the exchange's canonical source chain.");
  }
  const expectedFeed = observation.feedAddress ?? ZERO_ADDRESS;
  if (!sameAddress(canonical.feedAddress, expectedFeed)) {
    mismatch("Ingested feed does not match the exchange's canonical feed.");
  }
  if (canonical.simulated !== (observation.sourceKind === "simulated")) {
    mismatch("Ingested simulation flag does not match the exchange's canonical flag.");
  }
}
