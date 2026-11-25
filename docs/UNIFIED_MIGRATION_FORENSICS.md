# Unified Migration Forensics

This document records how the current `kyrox` monorepo was assembled from the
legacy repositories and what was deliberately **not** adopted. It is provenance
evidence, not a release claim, deployment record, or reward contract.

## 1. Repository consolidation map

| Legacy surface                         | Current location                                                      | Evidence                                                                                                                                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `kyro-mcp` repository root             | `services/mcp-server/`                                                | Imported by PR #2 (`1bebed7`, merge of migration/02-import-mcp). The old repository root maps one-to-one to the package directory.                                                                           |
| Legacy MCP documentation and packaging | `services/mcp-server/README.md`, `pyproject.toml`, `tests/`, `tools/` | Preserved with package-relative paths. `services/mcp-server/BOUNTY.md` is retained as the exact Day 13 copy for package provenance.                                                                          |
| Standalone content projects            | `content/` at the monorepo root                                       | Relocated by `ecd9434` from the imported MCP subtree to `content/day-5-carousel`, `content/day-6-architecture`, `content/kyrox-motion`, `content/kyrox-product-film`, and `content/kyrox-showcase-vertical`. |
| Legacy `kyrox-app` consumer hardening  | `apps/web/lib/server/**`, `apps/web/app/api/**`                       | Integrated selectively; see section 3.                                                                                                                                                                       |

The Day 13 bounty release line is commit `8e418cc` in `kyro-mcp`
(`docs(day13): add GitHub bug report issue form, BOUNTY.md, and early tester
documentation`). That commit added the original `BOUNTY.md`, the bug report
issue form, and README section 19. The root `BOUNTY.md` in this repository is
now canonical for the unified repository. The MCP copy remains byte-for-byte
preserved at `services/mcp-server/BOUNTY.md`; its links are package-relative.

The original Day 13 issue template was not preserved under
`services/mcp-server/.github/`. The current root
`.github/ISSUE_TEMPLATE/bug_report.yml` was rewritten for the unified component
list and now links back to the canonical root `BOUNTY.md` and `SECURITY.md`.

## 2. Canonical bounty and early-tester documentation

- Canonical programme rules and amounts: [`BOUNTY.md`](../BOUNTY.md).
- Concise tester/reward summary: [`README.md`](../README.md), section
  "Early Tester Programme, Bug Reporting & Contribution Rewards".
- Security disclosure: [`SECURITY.md`](../SECURITY.md).
- Package provenance copy: [`services/mcp-server/BOUNTY.md`](../services/mcp-server/BOUNTY.md).

No reward amount, activation date, funding status, payout-network status, legal
status, or badge status was changed during consolidation. The only edits to the
canonical copy are repository links, the canonical-copy notice, package-relative
path corrections, and updating the factual testnet token list from three to the
current seven assets (`tAAPL`, `tNVDA`, `tMSFT`, `tGOOGL`, `tAMZN`, `tTSLA`,
`tMETA`).

## 3. Legacy `kyrox-app` hardening integrated

The following uncommitted hardening from the legacy `kyrox-app` working tree was
integrated into the current unified architecture without reverting existing
unified improvements:

- Canonical `APP_ORIGIN` validation in `apps/web/lib/server/origin.ts`, with
  HTTPS required in live Base Sepolia mode and loopback-only local defaults.
- SIWE host/URI binding to the canonical origin, verified during signature
  verification (`ORIGIN_MISMATCH`), replacing the hardcoded `KYROX` /
  `https://kyrox.local/auth` values.
- Exact `Origin` checks for mutation routes. Missing `Origin` fails closed in
  production and is accepted only for loopback development origins.
- One process-scoped PostgreSQL pool for the web app
  (`apps/web/lib/server/database.ts`, preserved on `globalThis`), replacing
  per-request pool creation and teardown in quote, portfolio, activity, market,
  and observation paths.
- `/api/healthz` liveness and `/api/readyz` readiness endpoints. Readiness is
  dependency-free in preview mode (valid signed-session secret only) and uses a
  bounded `SELECT 1` in live mode.
- Correlated, redacted API failures. Typed domain errors keep their public
  messages; unexpected infrastructure failures return a generic `503` plus a
  request id, never raw SQL, RPC URLs, filesystem paths, or driver text.

The unified repository already had stronger typed error mapping, demo-mode
session handling, response envelopes, and database configuration than the
legacy slice. Those improvements were retained.

## 4. Unmerged MCP v0.2 stash — found, validated, not adopted

A prior local `kyro-mcp` workspace contains an unmerged v0.2 modular MCP
rewrite in a Git stash. Exact provenance:

| Item            | Value                                                                  |
| --------------- | ---------------------------------------------------------------------- |
| Stash ref       | `refs/stash` (`stash@{0}`)                                             |
| Stash commit    | `599fc614d272d45a974ad04937952c1d9387584b`                             |
| Base commit     | `323388b4b28b18034f2b17d686983aaa0e739974`                             |
| Base branch     | `feature/kyrox-complete-platform-upgrade`                              |
| Stash timestamp | `2026-11-21 11:24:41 +0530`                                            |
| Stash message   | `On feature/kyrox-complete-platform-upgrade: mac-v0.2-20261121-112441` |
| Untracked tree  | `cd98bfad7cce33e116e6a39fbe31da4f1a03f9db`                             |
| Scope           | 40 files, 5,899 insertions                                             |

The untracked tree contains the modular `kyrox/` package
(`config.py`, `data.py`, `models.py`, `policy.py`, `tx.py`, `wallet.py`,
`services.py`, `audit.py`, `invoke.py`, `server.py`, and related modules),
`tools/general.py`, `tools/transactions.py`, `tools/wallet.py`, schema-v2 data
under `kyrox/data/stocks.json`, and a replacement test suite (`tests/`).

It was extracted and validated **in isolation** from the active repository
line: the isolated extraction reported **245 passing tests**. It is not the
Day 13 release line. The active unified `services/mcp-server` remains the v0.1
line (407 pytest tests in the documented locked environment) and is the only
line represented in CI, packaging, and the bounty documentation.

**Decision: not adopted without explicit product approval.** Replacing the
active v0.1 release line with the v0.2 rewrite changes package layout, tool
surface, data schema, and test baseline; that is a product decision, not a
mechanical migration. No v0.2 code, data, or tests were copied into
`services/mcp-server`. The stash remains untouched in the legacy workspace for
review.

## 5. Boundaries of this document

- No commit, push, deploy, migration, or manifest activation is implied.
- The suggested USDC programme pool, payout network, treasury, legal review, and
  Early Builder badge remain exactly as disclosed in [`BOUNTY.md`](../BOUNTY.md):
  unconfirmed, pending, or planned as stated there.
- This document is Markdown provenance. The PDF requirement matrix lives
  separately in [`REQUIREMENTS_TRACEABILITY.md`](REQUIREMENTS_TRACEABILITY.md).
