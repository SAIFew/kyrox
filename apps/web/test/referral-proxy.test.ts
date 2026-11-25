import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "../proxy.js";

describe("referral proxy", () => {
  it("stores a valid referral code in a first-party HTTP-only cookie", () => {
    const response = proxy(new NextRequest("https://app.kyrox.example/?ref=kxabc123"));
    expect(response.cookies.get("kyrox_ref")?.value).toBe("KXABC123");
    expect(response.cookies.get("kyrox_ref")?.httpOnly).toBe(true);
  });

  it("ignores malformed referral codes", () => {
    for (const value of ["", "ABC123", "KX12345", "KXZZZZZZ", "<script>"]) {
      const response = proxy(
        new NextRequest(`https://app.kyrox.example/?ref=${encodeURIComponent(value)}`),
      );
      expect(response.cookies.get("kyrox_ref")).toBeUndefined();
    }
  });
});
