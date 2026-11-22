/**
 * Typed error taxonomy for the KYROX core domain.
 *
 * Every rejection carries a stable machine-readable code so the API, the UI,
 * the agent service, and the Python MCP adapter can agree on behaviour without
 * parsing prose. Codes are part of the public contract of this package.
 */
export type CoreErrorCode =
  | "INVALID_AMOUNT"
  | "INVALID_DECIMALS"
  | "INVALID_PRICE"
  | "INVALID_SLIPPAGE"
  | "INVALID_TIMESTAMP"
  | "FUTURE_TIMESTAMP"
  | "STALE_PRICE"
  | "UNSUPPORTED_ASSET"
  | "ASSET_DISABLED"
  | "EXCHANGE_PAUSED"
  | "MARKET_CLOSED"
  | "TRADE_BELOW_MINIMUM"
  | "TRADE_ABOVE_MAXIMUM"
  | "DAILY_LIMIT_EXCEEDED"
  | "QUOTE_EXPIRED"
  | "QUOTE_MISMATCH"
  | "ZERO_OUTPUT"
  | "INVALID_ROUND";

export class CoreError extends Error {
  override readonly name = "CoreError";

  constructor(
    readonly code: CoreErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Narrow helper so callers can branch on the code without `instanceof` noise. */
export function isCoreError(error: unknown): error is CoreError {
  return error instanceof CoreError;
}
