import { CoreError } from "./errors.js";

/** EIP-55-style hex address. Never a real mainnet address in Phase 0 config. */
export type Address = `0x${string}`;

/**
 * How a price observation was produced.
 *
 * `simulated` must never be presented as a Chainlink price. The distinction is
 * carried through quotes and policy decisions so the UI can label it honestly.
 */
export type PriceSourceKind = "chainlink-coinbase" | "simulated";

/**
 * Decimals a stock token may use in this phase.
 *
 * 6 and 8 exist so the engine is exercised against production-like B20
 * semantics before those tokens are integrated. 18 is the initial test token.
 * Nothing here assumes a single global precision.
 */
export const SUPPORTED_STOCK_DECIMALS = [6, 8, 18] as const;
export type SupportedStockDecimals = (typeof SUPPORTED_STOCK_DECIMALS)[number];

export interface AssetDefinition {
  readonly symbol: string;
  readonly name: string;
  /** Null until a deployment manifest provides a verified Base Sepolia address. */
  readonly stockToken: Address | null;
  readonly stockDecimals: SupportedStockDecimals;
  readonly priceSourceKind: PriceSourceKind;
  readonly listed: boolean;
}

const SYMBOL_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,9}$/;

export function isSupportedStockDecimals(value: number): value is SupportedStockDecimals {
  return (SUPPORTED_STOCK_DECIMALS as readonly number[]).includes(value);
}

export function assertAssetDefinition(asset: AssetDefinition): AssetDefinition {
  if (!SYMBOL_PATTERN.test(asset.symbol)) {
    throw new CoreError(
      "UNSUPPORTED_ASSET",
      `Invalid asset symbol "${asset.symbol}": expected 1-10 uppercase alphanumeric characters.`,
    );
  }
  if (!isSupportedStockDecimals(asset.stockDecimals)) {
    throw new CoreError(
      "INVALID_DECIMALS",
      `Asset ${asset.symbol} uses unsupported decimals ${asset.stockDecimals}; expected one of ${SUPPORTED_STOCK_DECIMALS.join(", ")}.`,
    );
  }
  if (asset.priceSourceKind !== "chainlink-coinbase" && asset.priceSourceKind !== "simulated") {
    throw new CoreError("INVALID_PRICE", `Asset ${asset.symbol} has an unknown price source kind.`);
  }
  if (typeof asset.listed !== "boolean") {
    throw new CoreError("UNSUPPORTED_ASSET", `Asset ${asset.symbol} has an invalid listed flag.`);
  }
  return asset;
}

/**
 * Immutable catalogue of tradable assets.
 *
 * Lookups are exact-match and case-sensitive. An unknown symbol is a hard
 * rejection, not a default.
 */
export class AssetRegistry {
  readonly #bySymbol: ReadonlyMap<string, AssetDefinition>;

  constructor(assets: readonly AssetDefinition[]) {
    const map = new Map<string, AssetDefinition>();
    for (const asset of assets) {
      assertAssetDefinition(asset);
      if (map.has(asset.symbol)) {
        throw new CoreError("UNSUPPORTED_ASSET", `Duplicate asset symbol ${asset.symbol}.`);
      }
      map.set(asset.symbol, asset);
    }
    this.#bySymbol = map;
  }

  has(symbol: string): boolean {
    return this.#bySymbol.has(symbol);
  }

  get(symbol: string): AssetDefinition {
    const asset = this.#bySymbol.get(symbol);
    if (asset === undefined) {
      throw new CoreError("UNSUPPORTED_ASSET", `Unsupported asset "${symbol}".`);
    }
    return asset;
  }

  /** Only tradable assets; delisted entries stay resolvable but are never quoted. */
  listTradable(): readonly AssetDefinition[] {
    return [...this.#bySymbol.values()].filter((asset) => asset.listed);
  }
}

/**
 * Phase 0 testnet catalogue.
 *
 * No token addresses are invented here: `stockToken` stays null until a
 * verified Base Sepolia deployment is recorded in `deployments/base-sepolia.json`.
 * Every asset is a plain test instrument with an explicit test name; none of
 * them carries a company logo.
 */
export const TESTNET_ASSETS: readonly AssetDefinition[] = [
  {
    symbol: "tAAPL",
    name: "Test Apple",
    stockToken: null,
    stockDecimals: 18,
    priceSourceKind: "simulated",
    listed: true,
  },
  {
    symbol: "tNVDA",
    name: "Test NVIDIA",
    stockToken: null,
    stockDecimals: 18,
    priceSourceKind: "simulated",
    listed: true,
  },
  {
    symbol: "tMSFT",
    name: "Test Microsoft",
    stockToken: null,
    stockDecimals: 18,
    priceSourceKind: "simulated",
    listed: true,
  },
  {
    symbol: "tGOOGL",
    name: "Test Google",
    stockToken: null,
    stockDecimals: 18,
    priceSourceKind: "simulated",
    listed: true,
  },
  {
    symbol: "tAMZN",
    name: "Test Amazon",
    stockToken: null,
    stockDecimals: 18,
    priceSourceKind: "simulated",
    listed: true,
  },
  {
    symbol: "tTSLA",
    name: "Test Tesla",
    stockToken: null,
    stockDecimals: 18,
    priceSourceKind: "simulated",
    listed: true,
  },
  {
    symbol: "tMETA",
    name: "Test Meta",
    stockToken: null,
    stockDecimals: 18,
    priceSourceKind: "simulated",
    listed: true,
  },
];

export const testnetAssetRegistry = new AssetRegistry(TESTNET_ASSETS);
