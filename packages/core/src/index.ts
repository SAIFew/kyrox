export {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  MAX_TOKEN_DECIMALS,
  PHASE0_STOCK_TOKEN_DECIMALS,
  PRODUCT_CHAIN_ENV,
  TUSDC_DECIMALS,
} from "./chains.js";
export type { ChainEnvironment } from "./chains.js";
export { assertSafeDecimals, fromBaseUnits, toBaseUnits, TokenAmountError } from "./units.js";

export {
  AssetRegistry,
  SUPPORTED_STOCK_DECIMALS,
  TESTNET_ASSETS,
  assertAssetDefinition,
  isSupportedStockDecimals,
  testnetAssetRegistry,
} from "./assets.js";
export type {
  Address,
  AssetDefinition,
  PriceSourceKind,
  SupportedStockDecimals,
} from "./assets.js";

export { CoreError, isCoreError } from "./errors.js";
export type { CoreErrorCode } from "./errors.js";

export {
  assessFreshness,
  assertPriceObservation,
  assertPriceWithinBounds,
  isSimulatedPrice,
} from "./price.js";
export type {
  AssetFreshnessConfig,
  FreshnessAssessment,
  MarketSession,
  PriceBounds,
  PriceObservation,
  PriceUsdcPerWholeToken,
} from "./price.js";

export {
  DEFAULT_QUOTE_TTL_SECONDS,
  MAX_SLIPPAGE_BPS,
  MAX_UINT256,
  ROUNDING_DIRECTION,
  assertPositiveAmount,
  calculateBuyStockOut,
  calculateMinAmountOut,
  calculateSellUsdcOut,
  createQuote,
  quoteNotionalUsdc,
} from "./quote.js";
export type { CreateQuoteOptions, Quote, QuoteRequest, TradeSide } from "./quote.js";

export {
  SECONDS_PER_UTC_DAY,
  TESTNET_TRADE_POLICY,
  assertPolicyAllows,
  evaluateTradePolicy,
  remainingDailyLimit,
} from "./policy.js";
export type {
  PolicyContext,
  PolicyDecision,
  PolicyViolation,
  TradePolicyConfig,
} from "./policy.js";
