import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { exactApprovalAmount } from "../lib/approvals.js";

describe("exact approval amounts", () => {
  it("returns exactly the prepared intent amount", () => {
    expect(exactApprovalAmount("2896051759349126")).toBe(2_896_051_759_349_126n);
  });

  it("rejects empty, fractional, zero, negative and hex values", () => {
    for (const value of ["", "1.5", "0", "-1", "0x10"]) {
      expect(() => exactApprovalAmount(value)).toThrow();
    }
  });

  it("the buy/sell UI never grants an unlimited allowance", () => {
    const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
    expect(page).not.toContain("2n ** 256n - 1n");
    expect(page).toContain("exactApprovalAmount(intent.amountIn)");
  });
});
