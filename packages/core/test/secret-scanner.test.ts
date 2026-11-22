import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  HISTORICAL_COMMIT_PATH_ALLOWLIST,
  HISTORICAL_WEB3_DOC_EXAMPLE_SHA256,
  scanFileContent,
  scanPatchContent,
  sha256Hex,
} from "../../../scripts/scan-secrets.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// Reconstruct the historical public web3.py doc example key at runtime without storing the raw literal in source.
const HISTORICAL_FIXTURE_BARE = [
  "4c0883a69102937d",
  "6231471b5dbb6204",
  "fe5129617082792a",
  "e468d01a3f362318",
].join("");
const HISTORICAL_FIXTURE_0X = `0x${HISTORICAL_FIXTURE_BARE}`;

const SYNTHETIC_PEM_LINE = ["-----BEGIN ", "EC PRIVATE KEY-----"].join("");
const SYNTHETIC_OPENAI_KEY = ["sk-proj-", "99887766554433221100aabbccddeeff"].join("");
const SYNTHETIC_GITHUB_PAT = ["ghp_", "1234567890abcdefghijklmnopqrstuv"].join("");
const SYNTHETIC_HEX64 = `0x${"cd".repeat(32)}`;

describe("Full-history secret scanner regression tests (scripts/scan-secrets.mjs)", () => {
  it("computes the exact SHA-256 digest of the normalized bare lowercase 64-hex historical fixture", () => {
    expect(sha256Hex(HISTORICAL_FIXTURE_BARE)).toBe(HISTORICAL_WEB3_DOC_EXAMPLE_SHA256);
    expect(HISTORICAL_WEB3_DOC_EXAMPLE_SHA256).toBe(
      "95e82a7ebb036b3c3b3c14120ed7ce5f356ac69348bf38a71e8e117c1ef8c7e0",
    );
  });

  it("accepts the historical fixture only in its exact approved historical commit and file-path combinations", () => {
    const approvedPairs: Array<[string, string]> = [
      ["d19fee0260f4581afb8533e707ccb36453d8cbf3", "tests/test_logging_and_errors.py"],
      ["4675bd501a7529a3a499f2cd9e8e94e10cb92b74", "tests/test_portfolio.py"],
      ["4675bd501a7529a3a499f2cd9e8e94e10cb92b74", "tests/test_tx.py"],
      ["cf04939bb17903a6bd9107329077b856e61df06b", "tests/test_policy.py"],
      [
        "fd4c9817fb1de47fcd0fa1c17dac87167f26602f",
        "services/mcp-server/tests/test_logging_and_errors.py",
      ],
      ["fd4c9817fb1de47fcd0fa1c17dac87167f26602f", "services/mcp-server/tests/test_policy.py"],
      ["fd4c9817fb1de47fcd0fa1c17dac87167f26602f", "services/mcp-server/tests/test_portfolio.py"],
      ["fd4c9817fb1de47fcd0fa1c17dac87167f26602f", "services/mcp-server/tests/test_tx.py"],
      [
        "1bebed73f95a16c55bf8a730bfa4240fc7dbd46f",
        "services/mcp-server/tests/test_logging_and_errors.py",
      ],
      ["1bebed73f95a16c55bf8a730bfa4240fc7dbd46f", "services/mcp-server/tests/test_policy.py"],
      ["1bebed73f95a16c55bf8a730bfa4240fc7dbd46f", "services/mcp-server/tests/test_portfolio.py"],
      ["1bebed73f95a16c55bf8a730bfa4240fc7dbd46f", "services/mcp-server/tests/test_tx.py"],
    ];

    let totalConfiguredPairs = 0;
    for (const [, pathMap] of HISTORICAL_COMMIT_PATH_ALLOWLIST) {
      totalConfiguredPairs += pathMap.size;
    }
    expect(totalConfiguredPairs).toBe(approvedPairs.length);

    for (const [commit, filePath] of approvedPairs) {
      const patch = [
        `+++ b/${filePath}`,
        "@@ -1,0 +1,3 @@",
        "+SAMPLE_RAW_PRIVATE_KEY = (",
        `+    "${HISTORICAL_FIXTURE_0X}"`,
        "+)",
      ].join("\n");
      const findings = scanPatchContent({ commit, patch, scope: "history" });
      expect(findings).toEqual([]);
    }
  });

  it("rejects the historical fixture in HEAD even inside an otherwise approved test file path", () => {
    const findings = scanFileContent({
      filePath: "services/mcp-server/tests/test_logging_and_errors.py",
      content: `SAMPLE_RAW_PRIVATE_KEY = "${HISTORICAL_FIXTURE_0X}"\n`,
      scope: "HEAD",
      commit: "HEAD",
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      scope: "HEAD",
      commit: "HEAD",
      filePath: "services/mcp-server/tests/test_logging_and_errors.py",
      lineNumber: 1,
      rule: "historical-key-fixture-outside-allowlist",
      fingerprint: "95e82a7e",
    });
  });

  it("rejects the historical fixture in any new commit even inside an approved test file path", () => {
    const newCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const patch = [
      "+++ b/services/mcp-server/tests/test_logging_and_errors.py",
      "@@ -54,1 +54,1 @@",
      `+SAMPLE_RAW_PRIVATE_KEY = "${HISTORICAL_FIXTURE_0X}"`,
    ].join("\n");

    const findings = scanPatchContent({ commit: newCommit, patch, scope: "history" });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      scope: "history",
      commit: newCommit,
      filePath: "services/mcp-server/tests/test_logging_and_errors.py",
      rule: "historical-key-fixture-outside-allowlist",
      fingerprint: "95e82a7e",
    });
  });

  it("rejects the historical fixture in an unapproved file or mismatched historical commit/path pair", () => {
    // Unapproved file in an approved commit
    const unapprovedFilePatch = [
      "+++ b/services/mcp-server/server.py",
      "@@ -1,0 +1,1 @@",
      `+LEAK = "${HISTORICAL_FIXTURE_0X}"`,
    ].join("\n");
    const fileFindings = scanPatchContent({
      commit: "d19fee0260f4581afb8533e707ccb36453d8cbf3",
      patch: unapprovedFilePatch,
      scope: "history",
    });
    expect(fileFindings).toHaveLength(1);
    expect(fileFindings[0]?.rule).toBe("historical-key-fixture-outside-allowlist");

    // Cross-product mismatch: tests/test_policy.py was introduced in cf04939..., NOT d19fee02...
    const mismatchedPairPatch = [
      "+++ b/tests/test_policy.py",
      "@@ -1,0 +1,1 @@",
      `+LEAK = "${HISTORICAL_FIXTURE_0X}"`,
    ].join("\n");
    const pairFindings = scanPatchContent({
      commit: "d19fee0260f4581afb8533e707ccb36453d8cbf3",
      patch: mismatchedPairPatch,
      scope: "history",
    });
    expect(pairFindings).toHaveLength(1);
    expect(pairFindings[0]?.rule).toBe("historical-key-fixture-outside-allowlist");
  });

  it("detects synthetic PEM and API-key patterns in both formerly exempt test files", () => {
    for (const formerlyExemptPath of [
      "tests/test_logging_and_errors.py",
      "services/mcp-server/tests/test_logging_and_errors.py",
    ]) {
      const pemFindings = scanFileContent({
        filePath: formerlyExemptPath,
        content: `SAMPLE_PEM_KEY = "${SYNTHETIC_PEM_LINE}"\n`,
        scope: "HEAD",
        commit: "HEAD",
      });
      expect(pemFindings).toHaveLength(1);
      expect(pemFindings[0]?.rule).toBe("pem-private-key");

      const apiFindings = scanFileContent({
        filePath: formerlyExemptPath,
        content: `SAMPLE_API_KEY = "${SYNTHETIC_OPENAI_KEY}"\n`,
        scope: "HEAD",
        commit: "HEAD",
      });
      expect(apiFindings).toHaveLength(1);
      expect(apiFindings[0]?.rule).toBe("api-key-prefix");
    }
  });

  it("detects split-across-lines private-key assignments in both HEAD files and commit diffs", () => {
    const multilineContent = ["SAMPLE_RAW_PRIVATE_KEY = (", `    "${SYNTHETIC_HEX64}"`, ")"].join(
      "\n",
    );

    const headFindings = scanFileContent({
      filePath: "services/mcp-server/tests/test_policy.py",
      content: multilineContent,
      scope: "HEAD",
      commit: "HEAD",
    });
    expect(headFindings).toHaveLength(1);
    expect(headFindings[0]).toMatchObject({
      scope: "HEAD",
      filePath: "services/mcp-server/tests/test_policy.py",
      lineNumber: 2,
      rule: "hex64-private-key-assignment",
    });

    // Also verify when the identifier line is an unchanged diff context line (' ') and only the hex literal is added ('+')
    const contextSplitPatch = [
      "+++ b/services/mcp-server/tests/test_policy.py",
      "@@ -83,3 +83,3 @@",
      " SAMPLE_RAW_PRIVATE_KEY = (",
      `+    "${SYNTHETIC_HEX64}"`,
      " )",
    ].join("\n");
    const patchFindings = scanPatchContent({
      commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      patch: contextSplitPatch,
      scope: "history",
    });
    expect(patchFindings).toHaveLength(1);
    expect(patchFindings[0]).toMatchObject({
      scope: "history",
      filePath: "services/mcp-server/tests/test_policy.py",
      lineNumber: 84,
      rule: "hex64-private-key-assignment",
    });
  });

  it("detects ordinary single-line private-key and API-key patterns and stays consistent with .gitleaks.toml", () => {
    const singleLineFindings = scanFileContent({
      filePath: "apps/web/src/config.ts",
      content: [
        `const deployerPrivateKey = "${SYNTHETIC_HEX64}";`,
        `const ghToken = "${SYNTHETIC_GITHUB_PAT}";`,
      ].join("\n"),
      scope: "HEAD",
      commit: "HEAD",
    });
    expect(singleLineFindings.map((f) => f.rule)).toEqual([
      "hex64-private-key-assignment",
      "api-key-prefix",
    ]);

    const gitleaksToml = readFileSync(path.join(REPO_ROOT, ".gitleaks.toml"), "utf8");
    for (const [commit] of HISTORICAL_COMMIT_PATH_ALLOWLIST) {
      expect(gitleaksToml).toContain(commit);
    }
    expect(gitleaksToml).not.toContain("d19fee0963858cd1b4d8e2ca77b933cc6d1739d7");
  });
});
