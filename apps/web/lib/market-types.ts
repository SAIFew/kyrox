/**
 * Client-safe market and account shapes shared by the UI and the HTTP layer.
 *
 * Every payload that can represent a simulated reference observation carries an
 * explicit `simulated` flag. The UI must never present simulated data as a live
 * oracle reading.
 */

export type TradeSide = "buy" | "sell";

export interface MarketAsset {
  /** Token ticker, e.g. `tAAPL`. */
  readonly symbol: string;
  /** Underlying company name. */
  readonly name: string;
  /** One-line positioning copy for cards and detail pages. */
  readonly description: string;
  readonly sector: string;
  /** Stock token decimals (base units per whole token). */
  readonly decimals: number;
  /** Accent color used for the asset mark. */
  readonly accent: string;
  /** Ticker of the underlying listed equity. */
  readonly underlying: string;
}

export interface MarketSnapshot {
  readonly symbol: string;
  readonly priceUsdc: string;
  readonly change24hPct: number;
  readonly high24hUsdc: string;
  readonly low24hUsdc: string;
  /** Simulated 24h notional in USDC. */
  readonly volume24hUsdc: string;
  readonly sourceUpdatedAt: number;
  readonly observedAt: number;
  readonly fresh: boolean;
  readonly simulated: boolean;
}

export interface ChartPoint {
  readonly t: number;
  readonly p: number;
}

export type ChartRange = "1D" | "1W" | "1M" | "3M";

export interface MarketDetail extends MarketSnapshot {
  readonly asset: MarketAsset;
  readonly history: readonly ChartPoint[];
  readonly range: ChartRange;
  readonly highRangeUsdc: string;
  readonly lowRangeUsdc: string;
  readonly changeRangePct: number;
}

export interface AllocationSlice {
  readonly symbol: string;
  readonly name: string;
  readonly valueUsdc: string;
  readonly sharePct: number;
  readonly accent: string;
}

export interface PortfolioPosition {
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly amount: string;
  readonly priceUsdc: string | null;
  readonly valueUsdc: string | null;
  readonly change24hPct: number | null;
  readonly change24hUsdc: string | null;
  readonly stale: boolean;
  readonly simulated: boolean;
  /**
   * Simulated cost basis from the demo ledger. Live environments omit these
   * until a durable, reconciled cost-basis indexer exists; the UI must show
   * "unavailable" rather than infer a value.
   */
  readonly avgCostUsdc?: string | null;
  readonly costBasisUsdc?: string | null;
  readonly unrealizedPnlUsdc?: string | null;
  readonly unrealizedPnlPct?: number | null;
}

export interface PortfolioPayload {
  readonly address: string;
  readonly mode: "demo" | "live";
  readonly simulated: boolean;
  readonly cash: {
    readonly symbol: string;
    readonly amount: string;
    readonly valueUsdc: string;
  };
  readonly positions: readonly PortfolioPosition[];
  readonly allocation: readonly AllocationSlice[];
  readonly totalUsdc: string | null;
  readonly change24hUsdc: string | null;
  readonly change24hPct: number | null;
  readonly stale: boolean;
  readonly asOf: number;
}

export type ActivityStatus =
  "prepared" | "submitted" | "included" | "verified" | "failed" | "reorged" | "simulated";

export interface ActivityItem {
  readonly id: string;
  readonly symbol: string;
  readonly side: TradeSide;
  readonly amountIn: string;
  readonly amountOut: string | null;
  readonly priceUsdc: string | null;
  readonly status: ActivityStatus;
  readonly txHash: string | null;
  /** True when the fill exists only in the simulated venue. */
  readonly simulated: boolean;
  readonly createdAt: string;
}

export interface EnvironmentInfo {
  readonly mode: "demo" | "local-anvil" | "base-sepolia";
  readonly simulated: boolean;
  readonly chainId: number;
  readonly chainName: string;
  /** Public, credential-free RPC suitable for wallet chain switching. */
  readonly walletRpcUrl: string | null;
  readonly walletNetworkName: string;
  /** Human-readable status of the on-chain deployment. */
  readonly contracts: "not-deployed" | "local" | "deployed";
  readonly pricePublication: "simulated" | "configured";
  readonly appVersion: string;
  readonly walletConnect: boolean;
}

export interface SessionPayload {
  readonly address: string;
  readonly expiresAt: number;
  readonly demo: boolean;
}

export interface QuotePayload {
  readonly quoteId: string;
  readonly quoteToken: string;
  readonly symbol: string;
  readonly side: TradeSide;
  readonly priceUsdc: string;
  readonly amountIn: string;
  readonly amountOut: string;
  readonly minAmountOut: string;
  readonly amountInLabel: string;
  readonly amountOutLabel: string;
  readonly minAmountOutLabel: string;
  readonly sourceUpdatedAt: number;
  readonly expiresAt: number;
  /** Server-controlled quote lifetime in seconds. */
  readonly ttlSeconds: number;
  readonly simulated: boolean;
  readonly simulatedPrice: boolean;
  readonly limits: {
    readonly minUsdc: string;
    readonly maxUsdc: string;
    readonly dailyUsdc: string;
    readonly remainingUsdc: string;
  };
}

export interface PreparedIntentPayload {
  readonly intentId: string;
  readonly quoteId: string;
  readonly amountIn: string;
  readonly to: string;
  readonly data: string;
  readonly value: string;
  readonly hash: string;
  readonly deadline: number;
  readonly simulated: boolean;
  /** Demo mode executes in the simulated venue instead of a wallet. */
  readonly mode: "wallet" | "simulated";
}
