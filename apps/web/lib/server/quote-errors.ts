import { QuoteServiceError } from "@kyrox/trade-intent";

export interface MappedQuoteError {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

/**
 * Map the typed quote error code, not the human-readable message, to a stable
 * HTTP response. `err.message` is prose and may change; callers must branch on
 * `code`.
 */
export function mapQuoteError(err: unknown): MappedQuoteError {
  if (err instanceof QuoteServiceError) {
    switch (err.code) {
      case "UNAUTHENTICATED":
        return { status: 401, code: "auth", message: err.message };
      case "QUOTE_NOT_FOUND":
        return { status: 404, code: "quote_not_found", message: err.message };
      case "QUOTE_EXPIRED":
        return { status: 410, code: "quote_expired", message: err.message };
      case "QUOTE_REPLAYED":
        return { status: 409, code: "quote_replayed", message: err.message };
      case "QUOTE_TOKEN_INVALID":
        return { status: 400, code: "quote_token_invalid", message: err.message };
      case "QUOTE_ASSET_MISMATCH":
        return { status: 400, code: "quote_asset_mismatch", message: err.message };
      case "QUOTE_TTL_TOO_LONG":
        return { status: 400, code: "quote_ttl_too_long", message: err.message };
      case "POLICY_SOURCE_INVALID":
        return { status: 503, code: "policy_unavailable", message: err.message };
      case "TRADING_PAUSED":
        return { status: 423, code: "trading_paused", message: err.message };
      case "ACCOUNT_BANNED":
        return { status: 403, code: "account_banned", message: err.message };
    }
  }
  return {
    status: 400,
    code: "quote",
    message: err instanceof Error ? err.message : "Quote failed.",
  };
}
