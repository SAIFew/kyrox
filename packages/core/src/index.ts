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
  MAX_BASKET_LEGS,
  allocateBasketBudget,
  evaluateBasketPolicy,
  validateBasket,
} from "./basket.js";
export type { BasketLegInput, BasketSummary } from "./basket.js";

export {
  CURRENT_ELIGIBILITY_TERMS_VERSION,
  describeEligibilityReason,
  evaluateEligibility,
  normalizeCountryCode,
} from "./eligibility.js";
export type { EligibilityDecision, EligibilityInput, EligibilityReason } from "./eligibility.js";

export { GAP_BLOCK_BPS, GAP_WARN_BPS, assessGap } from "./gap.js";
export type { GapAction, GapAssessment } from "./gap.js";

export {
  POINTS_DISCLOSURE,
  QUESTS,
  isValidReferralCode,
  normalizeReferralCode,
  questProgress,
  rankLeaderboard,
  referralCodeForAddress,
  totalPoints,
} from "./growth.js";
export type {
  GrowthActivity,
  LeaderboardEntry,
  QuestDefinition,
  QuestId,
  QuestProgress,
  RankedLeaderboardEntry,
} from "./growth.js";

export {
  DEFAULT_QUOTE_TTL_SECONDS,
  MAX_SLIPPAGE_BPS,
  MAX_UINT256,
  ROUNDING_DIRECTION,
  assertPositiveAmount,
  assertTradeSide,
  calculateBuyStockOut,
  calculateMinAmountOut,
  calculateSellUsdcOut,
  createQuote,
  quoteNotionalUsdc,
} from "./quote.js";
export type { CreateQuoteOptions, Quote, QuoteRequest, TradeSide } from "./quote.js";

export {
  SECONDS_PER_UTC_DAY,
  TESTNET_POLICY_CEILING,
  TESTNET_TRADE_POLICY,
  assertPolicyAllows,
  evaluateTradePolicy,
  remainingDailyLimit,
  resolveEditablePolicy,
  tradePolicyFromEditable,
} from "./policy.js";
export type {
  EditablePolicy,
  PolicyContext,
  PolicyDecision,
  PolicyViolation,
  TradePolicyConfig,
} from "./policy.js";
