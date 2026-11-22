import { parseAbi } from "viem";

/**
 * Exact ABI of the deployed KYROX exchange surface.
 *
 * This is the single place off-chain code learns function signatures. It must
 * match `packages/contracts/src/KyroxExchange.sol`; a signature change here is a
 * protocol change, not a formatting change.
 */
export const KYROX_EXCHANGE_ABI = parseAbi([
  "function setPrice(address stockToken, uint256 priceUsdcPerWholeToken, uint256 sourceRoundId, uint256 sourceUpdatedAt, uint256 sourceChainId, address feedAddress, bool simulated)",
  "function buy(address stockToken, uint256 usdcIn, uint256 minStockOut, uint256 deadline) returns (uint256 stockOut)",
  "function sell(address stockToken, uint256 stockIn, uint256 minUsdcOut, uint256 deadline) returns (uint256 usdcOut)",
  "function quoteBuy(address stockToken, uint256 usdcIn) view returns (uint256)",
  "function quoteSell(address stockToken, uint256 stockIn) view returns (uint256)",
  "function observation(address stockToken) view returns (uint256 priceUsdcPerWholeToken, uint256 sourceRoundId, uint64 sourceUpdatedAt, uint64 publishedAt, uint64 sourceChainId, address feedAddress, bool simulated)",
  "function assetSettings(address stockToken) view returns (bool listed, uint8 stockDecimals, uint32 maxSourceAgeSeconds, uint16 maxPriceDeviationBps, uint256 minPriceUsdcPerWholeToken, uint256 maxPriceUsdcPerWholeToken)",
  "function paused() view returns (bool)",
]);

/** The subset of the interface the price publisher needs. */
export const SET_PRICE_ABI = parseAbi([
  "function setPrice(address stockToken, uint256 priceUsdcPerWholeToken, uint256 sourceRoundId, uint256 sourceUpdatedAt, uint256 sourceChainId, address feedAddress, bool simulated)",
]);

/** The subset the trade-intent builder needs. */
export const TRADE_ABI = parseAbi([
  "function buy(address stockToken, uint256 usdcIn, uint256 minStockOut, uint256 deadline) returns (uint256 stockOut)",
  "function sell(address stockToken, uint256 stockIn, uint256 minUsdcOut, uint256 deadline) returns (uint256 usdcOut)",
]);

/** ERC-20 metadata read needed before preparing any intent. */
export const ERC20_METADATA_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

/** Event emitted by the exchange on every accepted publication. */
export const PRICE_SET_EVENT_ABI = parseAbi([
  "event PriceSet(address indexed stockToken, uint256 priceUsdcPerWholeToken, uint256 sourceRoundId, uint256 sourceUpdatedAt, uint256 sourceChainId, address indexed feedAddress, bool simulated, uint256 publishedAt)",
]);
