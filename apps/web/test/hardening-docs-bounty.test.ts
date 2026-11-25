import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function relativeLinks(markdown: string): string[] {
  const links: string[] = [];
  const pattern = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of markdown.matchAll(pattern)) {
    const target = match[1];
    if (target === undefined) continue;
    if (/^(?:https?:|mailto:|tel:)/i.test(target) || target.startsWith("#")) continue;
    const path = target.replace(/^<|>$/g, "").split("#")[0]?.split("?")[0];
    if (path !== undefined && path.length > 0) links.push(decodeURIComponent(path));
  }
  return links;
}

describe("canonical root bounty documentation", () => {
  it("keeps the Day 13 amounts and programme statuses exactly", () => {
    const bounty = read("BOUNTY.md");
    for (const required of [
      "$10–$50 USDC",
      "$25 USDC",
      "first **six (6)**",
      "**$150 USDC** total",
      "**$50 USDC**",
      "**$150 USDC** split across the top three (3)",
      "$400 USDC",
      "UNCONFIRMED FUNDING",
      "UNCONFIRMED / PENDING OWNER",
      "PENDING OWNER REVIEW",
      "PLANNED / PENDING DEPLOYMENT",
      "no promise, hint, or expectation of future token conversion, financial yield, or airdrops",
    ]) {
      expect(bounty).toContain(required);
    }
  });

  it("declares the root copy canonical and preserves the MCP provenance copy", () => {
    const bounty = read("BOUNTY.md");
    const mcpBounty = read("services/mcp-server/BOUNTY.md");
    expect(bounty).toContain("canonical programme document for the unified");
    expect(bounty).toContain("preserved unchanged for MCP package provenance");
    expect(mcpBounty).toContain("$10–$50 USDC");
    expect(mcpBounty).toContain("$25 USDC");
    expect(mcpBounty).toContain("$150 USDC");
    expect(mcpBounty).toContain("$50 USDC");
    expect(mcpBounty).toContain("$400 USDC");
  });

  it("links the README summary, issue form, and security policy", () => {
    const readme = read("README.md");
    const template = read(".github/ISSUE_TEMPLATE/bug_report.yml");
    const security = read("SECURITY.md");
    expect(readme).toContain("## Early Tester Programme, Bug Reporting & Contribution Rewards");
    expect(readme).toContain("[BOUNTY.md](BOUNTY.md)");
    expect(readme).toContain("services/mcp-server/BOUNTY.md");
    expect(template).toContain("../../BOUNTY.md");
    expect(template).toContain("../../SECURITY.md");
    expect(security).toContain("[BOUNTY.md](BOUNTY.md)");
  });

  it("documents the legacy v0.2 stash provenance without adopting it", () => {
    const forensics = read("docs/UNIFIED_MIGRATION_FORENSICS.md");
    expect(forensics).toContain("599fc614d272d45a974ad04937952c1d9387584b");
    expect(forensics).toContain("323388b4b28b18034f2b17d686983aaa0e739974");
    expect(forensics).toContain("stash@{0}");
    expect(forensics).toContain("245 passing tests");
    expect(forensics).toContain("not adopted without explicit product approval");
    expect(forensics).toContain("services/mcp-server/");
  });

  it("has resolving relative links in the canonical bounty and forensics docs", () => {
    for (const document of [
      "BOUNTY.md",
      "docs/UNIFIED_MIGRATION_FORENSICS.md",
      "docs/REQUIREMENTS_TRACEABILITY.md",
      "docs/PLATFORM_OPERATIONS.md",
    ]) {
      const directory = dirname(join(ROOT, document));
      for (const link of relativeLinks(read(document))) {
        const target = link.startsWith("/") ? join(ROOT, link) : join(directory, link);
        expect(existsSync(target), `${document} -> ${link}`).toBe(true);
      }
    }
  });
});
