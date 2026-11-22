#!/usr/bin/env node
/**
 * Full-history and working-tree secret scanner for the KYROX monorepo.
 *
 * Scans:
 * 1. Every tracked file in the current HEAD working tree (`git ls-files`).
 * 2. Every commit diff across the entire reachable Git history (`git rev-list --all`
 *    with `git show -m --format= --unified=3 --no-color <commit>` so merge commits
 *    and multi-line assignment contexts are inspected against every parent).
 *
 * Security rules:
 * - Never prints a matched secret value to stdout/stderr or CI logs; reports only
 *   commit SHA, file path, line number, rule ID, and an 8-char SHA-256 fingerprint.
 * - Does not broadly allowlist 64-hex values, private keys, or test files.
 * - Enforces an exact historical commit -> file-path -> SHA-256 digest allowlist
 *   strictly for pre-Stage-4 Python redaction test fixtures in the 5 historical commits
 *   where those files were introduced or merged. Nothing in HEAD or any new commit can
 *   use the historical exception.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function fingerprint(value) {
  return sha256Hex(value).slice(0, 8);
}

// Public non-secret 64-hex constants (Base Sepolia genesis hash, checkpoint 61,800,000 hash, and zero bytes32).
export const PUBLIC_CHAIN_CONSTANTS = new Set([
  "0000000000000000000000000000000000000000000000000000000000000000",
  "0dcc9e089e30b90ddfc55be9a37dd15bc551aeee999d2e2b51414c54eaf934e4",
  "486d04900ac2e7f6de0d2960cf1aae9095a2a60756e2dcddeac9aca33e26d7ce",
]);

// SHA-256 digest of the normalized bare lowercase 64-character hex public web3.py/eth-account
// documentation example fixture used as a redaction test input prior to Stage 4.
export const HISTORICAL_WEB3_DOC_EXAMPLE_SHA256 =
  "95e82a7ebb036b3c3b3c14120ed7ce5f356ac69348bf38a71e8e117c1ef8c7e0";

// SHA-256 digests of the two synthetic unit-test token strings (EC PEM header and sk-proj
// test fixture) in historical commits of test_logging_and_errors.py prior to runtime construction.
export const HISTORICAL_TEST_PEM_HEADER_SHA256 =
  "33ea101ddbe7c33be8f143a2779736d0264a4f4c8f323331a4aa9a1f72d8ab2a";
export const HISTORICAL_TEST_SK_PREFIX_SHA256 =
  "72a07fb2b04c39bb4f7e63ad8f22210685797354c2a16b1ce01c996ea067652a";

// Exact historical commit -> exact file path -> allowed SHA-256 digest set.
// Not a cross-product: each historical commit is restricted to the specific file(s) it introduced.
export const HISTORICAL_COMMIT_PATH_ALLOWLIST = new Map([
  [
    "d19fee0260f4581afb8533e707ccb36453d8cbf3",
    new Map([
      [
        "tests/test_logging_and_errors.py",
        new Set([
          HISTORICAL_WEB3_DOC_EXAMPLE_SHA256,
          HISTORICAL_TEST_PEM_HEADER_SHA256,
          HISTORICAL_TEST_SK_PREFIX_SHA256,
        ]),
      ],
    ]),
  ],
  [
    "4675bd501a7529a3a499f2cd9e8e94e10cb92b74",
    new Map([
      ["tests/test_portfolio.py", new Set([HISTORICAL_WEB3_DOC_EXAMPLE_SHA256])],
      ["tests/test_tx.py", new Set([HISTORICAL_WEB3_DOC_EXAMPLE_SHA256])],
    ]),
  ],
  [
    "cf04939bb17903a6bd9107329077b856e61df06b",
    new Map([["tests/test_policy.py", new Set([HISTORICAL_WEB3_DOC_EXAMPLE_SHA256])]]),
  ],
  [
    "fd4c9817fb1de47fcd0fa1c17dac87167f26602f",
    new Map([
      [
        "services/mcp-server/tests/test_logging_and_errors.py",
        new Set([
          HISTORICAL_WEB3_DOC_EXAMPLE_SHA256,
          HISTORICAL_TEST_PEM_HEADER_SHA256,
          HISTORICAL_TEST_SK_PREFIX_SHA256,
        ]),
      ],
      ["services/mcp-server/tests/test_policy.py", new Set([HISTORICAL_WEB3_DOC_EXAMPLE_SHA256])],
      [
        "services/mcp-server/tests/test_portfolio.py",
        new Set([HISTORICAL_WEB3_DOC_EXAMPLE_SHA256]),
      ],
      ["services/mcp-server/tests/test_tx.py", new Set([HISTORICAL_WEB3_DOC_EXAMPLE_SHA256])],
    ]),
  ],
  [
    "1bebed73f95a16c55bf8a730bfa4240fc7dbd46f",
    new Map([
      [
        "services/mcp-server/tests/test_logging_and_errors.py",
        new Set([
          HISTORICAL_WEB3_DOC_EXAMPLE_SHA256,
          HISTORICAL_TEST_PEM_HEADER_SHA256,
          HISTORICAL_TEST_SK_PREFIX_SHA256,
        ]),
      ],
      ["services/mcp-server/tests/test_policy.py", new Set([HISTORICAL_WEB3_DOC_EXAMPLE_SHA256])],
      [
        "services/mcp-server/tests/test_portfolio.py",
        new Set([HISTORICAL_WEB3_DOC_EXAMPLE_SHA256]),
      ],
      ["services/mcp-server/tests/test_tx.py", new Set([HISTORICAL_WEB3_DOC_EXAMPLE_SHA256])],
    ]),
  ],
]);

export const TOKEN_PATTERNS = [
  { id: "pem-private-key", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g },
  {
    id: "api-key-prefix",
    re: /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{25,}|xox[baprs]-[A-Za-z0-9-]{12,}|xprv[A-Za-z0-9]{70,})\b/g,
  },
];

export const HEX64_RE = /(?<![A-Fa-f0-9xX])(?:0[xX])?([A-Fa-f0-9]{64})(?![A-Fa-f0-9])/g;
export const PRIVATE_KEY_ASSIGNMENT_RE =
  /(?:private_?key|priv_?key|signing_?key|secret_?key|deployer_?key)/i;

export function isAllowedHistoricalFixture({ scope, commit, filePath, digest }) {
  if (scope !== "history") {
    return false;
  }
  const commitPaths = HISTORICAL_COMMIT_PATH_ALLOWLIST.get(commit);
  if (!commitPaths) {
    return false;
  }
  const allowedDigests = commitPaths.get(filePath);
  if (!allowedDigests) {
    return false;
  }
  return allowedDigests.has(digest);
}

export function checkLine({
  scope,
  commit,
  filePath,
  lineNumber,
  line,
  contextText = line,
  findings = [],
}) {
  for (const { id, re } of TOKEN_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      const tokenDigest = sha256Hex(m[0]);
      if (isAllowedHistoricalFixture({ scope, commit, filePath, digest: tokenDigest })) {
        continue;
      }
      findings.push({
        scope,
        commit,
        filePath,
        lineNumber,
        rule: id,
        fingerprint: tokenDigest.slice(0, 8),
      });
    }
  }

  HEX64_RE.lastIndex = 0;
  let m;
  while ((m = HEX64_RE.exec(line)) !== null) {
    const bareLower = m[1].toLowerCase();
    if (PUBLIC_CHAIN_CONSTANTS.has(bareLower)) {
      continue;
    }
    const digest = sha256Hex(bareLower);
    if (digest === HISTORICAL_WEB3_DOC_EXAMPLE_SHA256) {
      if (isAllowedHistoricalFixture({ scope, commit, filePath, digest })) {
        continue;
      }
      findings.push({
        scope,
        commit,
        filePath,
        lineNumber,
        rule: "historical-key-fixture-outside-allowlist",
        fingerprint: digest.slice(0, 8),
      });
      continue;
    }

    if (PRIVATE_KEY_ASSIGNMENT_RE.test(contextText)) {
      findings.push({
        scope,
        commit,
        filePath,
        lineNumber,
        rule: "hex64-private-key-assignment",
        fingerprint: digest.slice(0, 8),
      });
    }
  }

  return findings;
}

export function scanFileContent({
  filePath,
  content,
  scope = "HEAD",
  commit = "HEAD",
  findings = [],
}) {
  const lines = content.split("\n");
  const recentLines = [];
  for (let i = 0; i < lines.length; i++) {
    recentLines.push(lines[i]);
    if (recentLines.length > 4) {
      recentLines.shift();
    }
    checkLine({
      scope,
      commit,
      filePath,
      lineNumber: i + 1,
      line: lines[i],
      contextText: recentLines.join("\n"),
      findings,
    });
  }
  return findings;
}

export function scanPatchContent({ commit, patch, scope = "history", findings = [] }) {
  let currentFile = "";
  let currentLine = 0;
  let recentLines = [];
  for (const rawLine of patch.split("\n")) {
    if (rawLine.startsWith("+++ b/")) {
      currentFile = rawLine.slice(6).trim();
      recentLines = [];
    } else if (rawLine.startsWith("@@ ")) {
      const match = /\+(\d+)/.exec(rawLine);
      currentLine = match ? Number(match[1]) - 1 : 0;
      recentLines = [];
    } else if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
      currentLine += 1;
      const content = rawLine.slice(1);
      recentLines.push(content);
      if (recentLines.length > 4) {
        recentLines.shift();
      }
      checkLine({
        scope,
        commit,
        filePath: currentFile,
        lineNumber: currentLine,
        line: content,
        contextText: recentLines.join("\n"),
        findings,
      });
    } else if (rawLine.startsWith(" ")) {
      currentLine += 1;
      recentLines.push(rawLine.slice(1));
      if (recentLines.length > 4) {
        recentLines.shift();
      }
    }
  }
  return findings;
}

export function runFullRepositoryScan({ cwd = process.cwd() } = {}) {
  const findings = [];

  const trackedFiles = execFileSync("git", ["ls-files"], { cwd, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);

  for (const filePath of trackedFiles) {
    if (/(^|\/)\.env(\.|$)/.test(filePath) && !filePath.endsWith(".env.example")) {
      findings.push({
        scope: "HEAD",
        commit: "HEAD",
        filePath,
        lineNumber: 0,
        rule: "tracked-env-file",
        fingerprint: fingerprint(filePath),
      });
    }
  }

  for (const filePath of trackedFiles) {
    if (filePath.endsWith(".png") || filePath.endsWith(".ico")) {
      continue;
    }
    const content = readFileSync(`${cwd}/${filePath}`, "utf8");
    scanFileContent({
      filePath,
      content,
      scope: "HEAD",
      commit: "HEAD",
      findings,
    });
  }

  const allCommits = execFileSync("git", ["rev-list", "--all"], { cwd, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);

  for (const commit of allCommits) {
    const patch = execFileSync(
      "git",
      ["show", "-m", "--format=", "--unified=3", "--no-color", commit],
      {
        cwd,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    scanPatchContent({
      commit,
      patch,
      scope: "history",
      findings,
    });
  }

  return {
    trackedFileCount: trackedFiles.length,
    commitCount: allCommits.length,
    findings,
  };
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const { trackedFileCount, commitCount, findings } = runFullRepositoryScan();
  if (findings.length > 0) {
    console.error(`Secret scan failed with ${findings.length} finding(s):`);
    for (const f of findings) {
      console.error(
        `  [${f.scope}] commit=${f.commit} file=${f.filePath}:${f.lineNumber} rule=${f.rule} sha256_prefix=${f.fingerprint}`,
      );
    }
    process.exit(1);
  }

  console.log(
    `Secret scan passed: ${trackedFileCount} tracked files in HEAD and ${commitCount} commits in full history scanned (0 leaks).`,
  );
}
