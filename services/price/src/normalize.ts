import { CoreError } from "@kyrox/core";

export const USDC_DECIMALS = 6;
export const MAX_REFERENCE_PRICE = 10n ** 24n;

/**
 * Convert a Chainlink answer into the KYROX convention.
 *
 * `answer` has `feedDecimals`; the result is 6-decimal USDC per one whole token.
 * The division floors, matching the on-chain exchange, and uses integer math only.
 *
 * This intentionally does not apply a Coinbase multiplier: the tokenized-equity
 * feed already reports a total-return value with the multiplier applied.
 */
export function normalizeChainlinkAnswer(answer: bigint, feedDecimals: number): bigint {
  if (answer <= 0n) {
    throw new CoreError("INVALID_PRICE", "Chainlink answer must be positive.");
  }
  if (!Number.isInteger(feedDecimals) || feedDecimals < 0 || feedDecimals > 18) {
    throw new CoreError("INVALID_DECIMALS", `Unsupported feed decimals: ${feedDecimals}.`);
  }
  const scale = 10n ** BigInt(feedDecimals);
  const usdcScale = 10n ** BigInt(USDC_DECIMALS);
  const normalized = (answer * usdcScale) / scale;
  if (normalized <= 0n) {
    throw new CoreError("INVALID_PRICE", "Answer is too small to normalize to 6 decimals.");
  }
  if (normalized > MAX_REFERENCE_PRICE) {
    throw new CoreError("INVALID_PRICE", "Normalized price exceeds the plausibility ceiling.");
  }
  return normalized;
}
