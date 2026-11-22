import { QuoteServiceError } from "@kyrox/trade-intent";
import { describe, expect, it } from "vitest";

import { mapQuoteError } from "../lib/server/quote-errors.js";

describe("quote error mapping", () => {
  it("maps typed quote codes to stable HTTP responses", () => {
    expect(mapQuoteError(new QuoteServiceError("UNAUTHENTICATED", "auth"))).toMatchObject({
      status: 401,
      code: "auth",
    });
    expect(mapQuoteError(new QuoteServiceError("QUOTE_NOT_FOUND", "missing"))).toMatchObject({
      status: 404,
      code: "quote_not_found",
    });
    expect(mapQuoteError(new QuoteServiceError("QUOTE_EXPIRED", "expired"))).toMatchObject({
      status: 410,
      code: "quote_expired",
    });
    expect(mapQuoteError(new QuoteServiceError("QUOTE_REPLAYED", "used"))).toMatchObject({
      status: 409,
      code: "quote_replayed",
    });
  });

  it("uses the code even when the message does not contain it", () => {
    expect(
      mapQuoteError(new QuoteServiceError("QUOTE_TOKEN_INVALID", "the signature is wrong")),
    ).toMatchObject({
      status: 400,
      code: "quote_token_invalid",
    });
  });

  it("keeps untyped failures as a generic quote error", () => {
    expect(mapQuoteError(new Error("boom"))).toEqual({
      status: 400,
      code: "quote",
      message: "boom",
    });
  });
});
