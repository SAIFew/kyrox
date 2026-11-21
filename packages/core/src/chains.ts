/**
 * Chain and token constants for the KYROX testnet MVP.
 *
 * Base Sepolia is the only chain this application may write to. Base Mainnet
 * is referenced read-only by the price service and must never be used for
 * signing, broadcasting, or user transactions.
 */
export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;
export const BASE_MAINNET_CHAIN_ID = 8453 as const;

export type ChainEnvironment = "base-sepolia" | "base-mainnet";

export const PRODUCT_CHAIN_ENV: ChainEnvironment = "base-sepolia";

/**
 * Decimal policy.
 *
 * tUSDC is 6dp. Test stock tokens stay at 18dp for Phase 0 unless an ADR
 * changes it. Conversions must always accept an explicit decimals argument so
 * future B20 tokens can be read from the deployed contract instead of assumed.
 */
export const TUSDC_DECIMALS = 6 as const;
export const PHASE0_STOCK_TOKEN_DECIMALS = 18 as const;

export const MAX_TOKEN_DECIMALS = 77 as const;
