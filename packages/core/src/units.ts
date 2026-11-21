import { MAX_TOKEN_DECIMALS } from "./chains.js";

/** Raised when a token amount or decimals value is invalid. */
export class TokenAmountError extends Error {
  override readonly name = "TokenAmountError";
}

const AMOUNT_PATTERN = /^\d+(?:\.\d+)?$/;
const MAX_INTEGER_DIGITS = 78;

export function assertSafeDecimals(decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_TOKEN_DECIMALS) {
    throw new TokenAmountError(
      `Invalid token decimals: expected an integer between 0 and ${MAX_TOKEN_DECIMALS}, got ${String(decimals)}.`,
    );
  }
  return decimals;
}

/**
 * Convert a human-readable decimal string into integer base units.
 *
 * Accepts only plain non-negative decimal strings. Floats, exponent notation,
 * and negative values are rejected so financial amounts never pass through
 * binary floating point.
 */
export function toBaseUnits(amount: string, decimals: number): bigint {
  const safeDecimals = assertSafeDecimals(decimals);
  const normalized = amount.trim();

  if (!AMOUNT_PATTERN.test(normalized)) {
    throw new TokenAmountError(
      `Invalid token amount: expected a non-negative decimal string, got "${amount}".`,
    );
  }

  const [integerPart = "", fractionPart = ""] = normalized.split(".");

  if (integerPart.length > MAX_INTEGER_DIGITS) {
    throw new TokenAmountError("Invalid token amount: integer part is too large.");
  }
  if (fractionPart.length > safeDecimals) {
    throw new TokenAmountError(
      `Invalid token amount: "${amount}" exceeds ${safeDecimals} decimal places.`,
    );
  }

  const paddedFraction = fractionPart.padEnd(safeDecimals, "0");
  const combined = `${integerPart}${paddedFraction}`.replace(/^0+(?=\d)/, "");

  return BigInt(combined);
}

/**
 * Convert integer base units into a human-readable decimal string.
 *
 * Trailing fractional zeros are trimmed. The result never uses exponent
 * notation and is safe for display and storage.
 */
export function fromBaseUnits(value: bigint, decimals: number): string {
  const safeDecimals = assertSafeDecimals(decimals);

  if (value < 0n) {
    throw new TokenAmountError("Invalid base-unit value: negative amounts are not supported.");
  }
  if (safeDecimals === 0) {
    return value.toString();
  }

  const divisor = 10n ** BigInt(safeDecimals);
  const integerPart = value / divisor;
  const fractionPart = (value % divisor).toString().padStart(safeDecimals, "0");
  const trimmedFraction = fractionPart.replace(/0+$/, "");

  return trimmedFraction.length > 0 ? `${integerPart}.${trimmedFraction}` : integerPart.toString();
}
