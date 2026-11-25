# ADR-0011: Unified monorepo and policy surface separation

- **Status:** Accepted (supersedes [ADR-0001](0001-separate-repository.md))
- **Date:** 2026-11-22
- **Phase:** 1

## Context

[ADR-0001](0001-separate-repository.md) originally kept the TypeScript consumer
application (`kyrox-app`) and the Python Model Context Protocol server
(`kyrox-mcp`) in separate repositories so that early prototyping of the Next.js
workspace, Foundry contracts, and Python STDIO package could proceed without
coupling their toolchains.

Now that both components have reached verified milestones—Phase 1 local
vertical slice for the TypeScript/Foundry workspace and `v0.1.0` (`400` passing
tests) for the Python MCP server—maintaining two separate repositories creates
operational friction for cross-surface invariant verification, unified CI
gating, security scanning, and coordinated review.

At the same time, [ADR-0002](0002-typescript-core-source-of-truth.md) and
[ADR-0005](0005-agent-tool-boundary.md) establish critical architectural
boundaries that consolidation must not blur:

1. `packages/core` is the canonical TypeScript source of truth for consumer
   exchange quote mathematics and USDC-denominated buy/sell trade policy.
2. The consumer-facing assistant (`services/agent`) must remain strictly
   read/quote-only, whereas the developer-facing Python MCP server
   (`services/mcp-server`) prepares and simulates unsigned ERC-20 transfer
   intents (`prepare_transaction`, `simulate_transaction`) for external human
   wallet signing.

## Decision

### 1. Consolidate into a single repository with isolated runtime boundaries

Consolidate `SAIFew/kyrox-app` and `SAIFew/kyrox-mcp` into one canonical
repository (`SAIFew/kyrox`) using a non-squashed Git subtree import so that
every historical commit from both repositories remains reachable unchanged:

- **pnpm / TypeScript workspace (`apps/*`, `packages/*`, `services/{agent,indexer,price,trade-intent}`):**
  Managed at the repository root by `pnpm@12.21.0` and Node.js 24.
- **Python MCP server (`services/mcp-server/`):**
  Remains a self-contained, independently installable Python `>=3.11` package
  (`pyproject.toml`, `MANIFEST.in`, `requirements*.txt`, nested Apache-2.0
  `LICENSE`, `README.md`, `SECURITY.md`, and `tests/`). It is not a pnpm
  workspace member.
- **Standalone media and Remotion projects (`content/*`):**
  Live under root `content/` (`day-5-carousel`, `day-6-architecture`,
  `kyrox-product-film`, `kyrox-motion`) using their own `package-lock.json`
  manifests outside the pnpm workspace.

### 2. Preserve distinct policy surfaces for exchange trades vs. MCP transfer intents

We explicitly preserve both policy implementations for their distinct operational
surfaces rather than forcefully rewriting one into the other:

- **Consumer Exchange Trade Policy (`packages/core/src/policy.ts`):**
  Governs fixed-reference-price exchange `buy` and `sell` quotes settled in
  6-decimal `tUSDC` (`minTradeUsdc: 1 tUSDC`, `maxTradeUsdc: 1,000 tUSDC`,
  `dailyLimitUsdc: 5,000 tUSDC`, oracle freshness, price bounds, market session,
  and exchange pause state).
- **Developer MCP Transfer Intent Policy (`services/mcp-server/tools/policy.py`, `v0.1-day11`):**
  Governs developer-facing MCP unsigned ERC-20 `transfer(address,uint256)`
  intent preparation and pinned-block EVM simulation (`<= 50` tokens per
  transfer, EIP-55 sender/recipient/contract validation, zero-address and
  self-transfer rejection, `requires_human_approval: true`, and fail-closed
  redacted JSONL audit logging).

Neither surface signs or broadcasts transactions; the human user's external
wallet is the sole signer in every flow.

### 3. Enforce shared safety invariants with automated cross-surface drift tests

Although the two policy engines govern different operations, they share core
protocol invariants that must never drift:

- **Target Write Chain ID:** Base Sepolia (`chainId: 84532`).
- **Approved Synthetic Asset Allowlist:** `tAAPL`, `tTSLA`, `tNVDA`.
- **Maximum Supported Token Decimal Bound:** `77`.

Automated cross-surface drift tests inspect the live canonical definitions in
`packages/core` and `services/mcp-server` on every CI run to guarantee that any
divergence fails the build immediately.

## Consequences

- One repository, one unified CI pipeline (JavaScript/Next.js, Python 3.11–3.13
  matrix, Foundry contracts, standalone content checks, PostgreSQL + Anvil
  integration tests, and full-history secret scanning), and full Git history
  from both source repositories.
- `services/mcp-server` remains independently installable as a standard Python
  wheel and sdist without Node.js runtime dependencies.
- No silent divergence between TypeScript and Python chain IDs or asset
  allowlists.

---

## Amendment — 2026-11-25: seven-asset testnet catalogue

The cross-surface allowlist in this ADR has since expanded from three to seven test assets to
match the Testnet MVP plan: `tAAPL`, `tNVDA`, `tMSFT`, `tGOOGL`, `tAMZN`, `tTSLA`, `tMETA`. The
decision itself (one canonical allowlist, enforced by cross-surface drift tests) is unchanged;
`packages/core/src/assets.ts` and `services/mcp-server/tools/policy.py` are the current sources of
truth. The original three-asset text above is retained as the historical decision record.
