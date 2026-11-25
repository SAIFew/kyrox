import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const DISCLAIMER = "Test tokens. No real value. Not real shares. Not investment advice.";

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8").replace(
    /\s+/g,
    " ",
  );
}

describe("explicit test-token disclosures", () => {
  it("puts the full disclaimer on the landing page and sign-in", () => {
    expect(read("../app/page.tsx")).toContain(DISCLAIMER);
    expect(read("../components/account-provider.tsx")).toContain(DISCLAIMER);
  });

  it("puts the full disclaimer and every required field on the quote card", () => {
    const panel = read("../components/trade-panel.tsx");
    expect(panel).toContain(DISCLAIMER);
    for (const label of [
      "<dt>Stock</dt>",
      "<dt>Amount</dt>",
      "<dt>Shares</dt>",
      "<dt>Reference price</dt>",
      "<dt>Price age</dt>",
      "<dt>Order limits</dt>",
      "<dt>Daily limit remaining</dt>",
    ]) {
      expect(panel).toContain(label);
    }
  });

  it("links the privacy notice from legal and sign-in", () => {
    const legal = read("../app/legal/page.tsx");
    const signIn = read("../components/account-provider.tsx");
    expect(legal).toContain('href="/privacy"');
    expect(signIn).toContain('href="/privacy"');
  });

  it("has a privacy page that limits collection to wallet address and optional email", () => {
    const privacy = read("../app/privacy/page.tsx");
    expect(privacy).toContain("wallet address");
    expect(privacy).toContain("optional email");
    expect(privacy).toContain("personal documents");
    expect(privacy).toContain("Private keys");
  });

  it("wires both welcome and daily claims into the live portfolio action", () => {
    const portfolio = read("../components/portfolio-view.tsx");
    expect(portfolio).toContain('name: "claimWelcome"');
    expect(portfolio).toContain('name: "claimDaily"');
    expect(portfolio).toContain("faucetEligibility");
    expect(portfolio).toContain("waitForTransactionReceipt");
  });
});
