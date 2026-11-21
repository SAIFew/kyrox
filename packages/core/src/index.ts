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
