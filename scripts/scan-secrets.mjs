#!/usr/bin/env node
/**
 * Full-history and working-tree secret scanner for the KYROX monorepo.
 *
 * Scans:
 * 1. Every tracked file in the current HEAD working tree (`git ls-files`).
 * 2. Every commit diff across the entire reachable Git history (`git log --all -p`).
 *
 * Security rules:
 * - Never prints a matched secret value to stdout/stderr or CI logs; reports only
 *   commit SHA, file path, line number, rule ID, and an 8-char SHA-256 fingerprint.
 * - Does not broadly allowlist 64-hex values or private keys.
 * - Enforces a strictly scoped historical exception for the public web3.py / eth-account
 *   documentation example key used as a redaction test input in four Python test files
 *   prior to Stage 4 (matched solely by SHA-256 digest, restricted to the exact frozen
 *   historical commit SHAs and exact test paths, and forbidden in HEAD or any new commit).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function fingerprint(value) {
  return sha256Hex(value).slice(0, 8);
}

// Public non-secret 64-hex constants (Base Sepolia genesis hash, checkpoint 61,800,000 hash, and zero bytes32).
const PUBLIC_CHAIN_CONSTANTS = new Set([
  "0000000000000000000000000000000000000000000000000000000000000000",
  "0dcc9e089e30b90ddfc55be9a37dd15bc551aeee999d2e2b51414c54eaf934e4",
  "486d04900ac2e7f6de0d2960cf1aae9095a2a60756e2dcddeac9aca33e26d7ce",
]);

// SHA-256 digest of the normalized 64-hex lowercase public web3.py/eth-account doc example key
// that appeared in 4 Python redaction test files before Stage 4 replaced it with `"ab" * 32`.
// The raw hex value is intentionally not stored in this scanner.
const HISTORICAL_WEB3_DOC_EXAMPLE_SHA256 =
  "bc932a12ef632cd3c0e324a46a400a6a1bd4fb39f65f820b279bb5fb9ee94b76";

const HISTORICAL_ALLOWED_COMMITS = new Set([
  "d19fee0963858cd1b4d8e2ca77b933cc6d1739d7",
  "4675bd501a7529a3a499f2cd9e8e94e10cb92b74",
  "59b4a3a7004dafc0c25756407e98371a3f024fae",
  "fcd023cb13a0fff2a36e7a241905da9d862b82f9",
  "cf04939bb17903a6bd9107329077b856e61df06b",
  "d0edc869085eaf25c8dc8c74ee57b509d84dfa9a",
  "6965210e301028af5acbde6dc4948a9a26243ccf",
  "63b2b9c65d2a8e9c61097fdd58f8bf370b3ac4e2",
  "8e418cc831dd44764e0fa07604f70896c8e0c698",
  "8cdb4c29a75a8b3e82c0bd7ea7b30640b82e8cdf",
  "b1620d7167b5927cd85c0890ff80baeed95405ae",
  "f3e6ff2c37c97f94dc4a2d9bb78f62f136146403",
  "7128531dc24609bfdd547373efe564b6646b3528",
  "fd4c9817fb1de47fcd0fa1c17dac87167f26602f",
  "ecd94349029a84ab6ec4ad1727efef95e7e4e4ad",
  "cc93e7d58a6b45e497d4950df1bda13efc3f84ef",
  "18b962d660cfa58ebdffb14cca62ad7a478ecf50",
  "1bebed73f95a16c55bf8a730bfa4240fc7dbd46f",
]);

const HISTORICAL_ALLOWED_PATHS = new Set([
  "tests/test_logging_and_errors.py",
  "tests/test_policy.py",
  "tests/test_portfolio.py",
  "tests/test_tx.py",
  "services/mcp-server/tests/test_logging_and_errors.py",
  "services/mcp-server/tests/test_policy.py",
  "services/mcp-server/tests/test_portfolio.py",
  "services/mcp-server/tests/test_tx.py",
]);

const REDACTION_UNIT_TEST_PATHS = new Set([
  "tests/test_logging_and_errors.py",
  "services/mcp-server/tests/test_logging_and_errors.py",
]);

const TOKEN_PATTERNS = [
  { id: "pem-private-key", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g },
  {
    id: "api-key-prefix",
    re: /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{25,}|xox[baprs]-[A-Za-z0-9-]{12,}|xprv[A-Za-z0-9]{70,})\b/g,
  },
];

const HEX64_RE = /(?<![A-Fa-f0-9xX])(?:0[xX])?([A-Fa-f0-9]{64})(?![A-Fa-f0-9])/g;

const findings = [];

function checkLine({ scope, commit, filePath, lineNumber, line }) {
  for (const { id, re } of TOKEN_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      if (REDACTION_UNIT_TEST_PATHS.has(filePath)) {
        continue;
      }
      findings.push({
        scope,
        commit,
        filePath,
        lineNumber,
        rule: id,
        fingerprint: fingerprint(m[0]),
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
      if (
        scope === "history" &&
        HISTORICAL_ALLOWED_COMMITS.has(commit) &&
        HISTORICAL_ALLOWED_PATHS.has(filePath)
      ) {
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

    if (/(?:private_?key|priv_?key|signing_?key|secret_?key|deployer_?key)/i.test(line)) {
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
}

const trackedFiles = execFileSync("git", ["ls-files"], { encoding: "utf8" })
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
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    checkLine({
      scope: "HEAD",
      commit: "HEAD",
      filePath,
      lineNumber: i + 1,
      line: lines[i],
    });
  }
}

const allCommits = execFileSync("git", ["rev-list", "--all"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);

for (const commit of allCommits) {
  const patch = execFileSync("git", ["show", "--format=", "--unified=0", "--no-color", commit], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  let currentFile = "";
  let currentLine = 0;
  for (const rawLine of patch.split("\n")) {
    if (rawLine.startsWith("+++ b/")) {
      currentFile = rawLine.slice(6).trim();
    } else if (rawLine.startsWith("@@ ")) {
      const match = /\+(\d+)/.exec(rawLine);
      currentLine = match ? Number(match[1]) - 1 : 0;
    } else if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
      currentLine += 1;
      checkLine({
        scope: "history",
        commit,
        filePath: currentFile,
        lineNumber: currentLine,
        line: rawLine.slice(1),
      });
    }
  }
}

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
  `Secret scan passed: ${trackedFiles.length} tracked files in HEAD and ${allCommits.length} commits in full history scanned (0 leaks).`,
);
