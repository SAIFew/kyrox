# KYROX

Unified monorepo for the **KYROX** Base Sepolia testnet platform: consumer web application, static marketing website, deterministic TypeScript quote and policy core, price ingestion and trade-intent services, Foundry smart contracts, Python Model Context Protocol (MCP) server, and standalone Remotion media projects.

> **Current Status (Base Sepolia Testnet Only — `chainId: 84532`):**
>
> - **TypeScript Application & Foundry Contracts:** Phase 1 complete locally; current Foundry suite has `95` passing tests. The current working tree passes `493` Vitest tests with `23` environment-gated skips, plus `11` PostgreSQL integration tests and local runtime smoke checks. Release still requires the live Sepolia deployment and checklist in [RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md). No Base Sepolia contract deployment and no live price publication exist yet (`deployments/base-sepolia.json` is `"status": "unpopulated"`).
> - **Python MCP Server (`services/mcp-server`):** `v0.1.0` complete (`7` registered STDIO MCP tools, deterministic 50-token transfer policy gate, fail-closed redacted JSONL audit logging, installable wheel/sdist, and `407` automated pytest tests passing in the locked local environment).
> - **Non-Custodial Boundary:** Testnet and local mock/Anvil fixtures only. No component holds private keys, signs transactions, broadcasts transactions, or supports real-money trading.

---

## Public Preview (deployed)

**Public preview URL:** <https://kyrox-dun.vercel.app> — Vercel project `kyrox` (root directory `apps/web`, Node 24, pnpm workspace). This is a live web deployment of a **simulated venue**, not a live Base Sepolia trading deployment.

The consumer application ships with a first-class **simulated preview** mode. It runs without PostgreSQL, a loopback Anvil node, or a deployed exchange, and every price, balance, and fill is labelled `simulated` in the interface.

- **Market data:** deterministic, time-based reference curves for all seven test stocks (`tAAPL`, `tNVDA`, `tMSFT`, `tGOOGL`, `tAMZN`, `tTSLA`, `tMETA`). No oracle is contacted. History, 24h ranges, volume, and freshness are generated locally.
- **Accounts:** an HMAC-sealed, HttpOnly preview session with simulated balances. Wallet sign-in is also supported: the wallet signature is verified, while the portfolio stays simulated and explicitly labelled.
- **Trading:** quotes run through the same `@kyrox/core` integer maths and `TESTNET_TRADE_POLICY` used by the contract tests. The review step shows price, output, minimum received, expiry, and daily limit. Confirming a preview fill updates the local session only; no calldata is built and nothing is broadcast.
- **Agent bridge:** `POST /api/mcp` is a read-only MCP (JSON-RPC 2.0) endpoint exposing `kyrox_list_markets`, `kyrox_get_market`, `kyrox_preview_quote`, and `kyrox_get_protocol_status`. It has no sign, send, transfer, or arbitrary-calldata tool.
- **Status:** `/status` and `/api/status` report contract, publication, and indexer state honestly, including what is not deployed.

Enable it explicitly with `KYROX_DEMO_MODE=1` and at least one 32-character secret in `AUTH_SECRET` (or `KYROX_DEMO_SECRET`). When `KYROX_DEMO_MODE` is blank or unset and `DATABASE_URL` is empty, the same mode is used automatically so a fresh deployment is immediately usable. Setting `KYROX_DEMO_MODE=0` disables that fallback and requires PostgreSQL, `KYROX_ENVIRONMENT=base-sepolia`, a loopback-free Base Sepolia RPC, and an approved `deployments/base-sepolia.json` with `status: deployed`. Keep the public preview explicitly in demo mode; do not silently promote it.

### Preview routes

| Route               | Purpose                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `/`                 | Product landing page with simulated preview market cards         |
| `/markets`          | Searchable, sortable market explorer                             |
| `/markets/[symbol]` | Price history, provenance, position, and order review            |
| `/portfolio`        | Simulated balances, allocation, P&L, share card, recent activity |
| `/rewards`          | Quests, points, referral link, weekly and all-time leaderboard   |
| `/basket`           | Up to four test-stock legs with one review                       |
| `/assistant`        | Deterministic read/quote assistant                               |
| `/activity`         | Fill and intent history with explicit status labels              |
| `/admin`            | Operator dashboard (live PostgreSQL + admin role only)           |
| `/developers`       | MCP configuration, tool catalogue, and live JSON-RPC playground  |
| `/status`           | Environment, service, and deployment transparency                |
| `/legal`            | Preview risk disclosure                                          |
| `/api/mcp`          | Read-only MCP bridge (GET metadata, POST JSON-RPC)               |
| `/api/healthz`      | Liveness only; no dependency or configuration probe              |
| `/api/readyz`       | Readiness; bounded PostgreSQL probe in live mode                 |
| `/api/admin/*`      | Role-checked admin data, policy, roles, audit, export            |
| `/api/share-card`   | Authenticated portfolio share image with referral link           |

The three supplied planning documents are mapped requirement-by-requirement in **[docs/REQUIREMENTS_TRACEABILITY.md](docs/REQUIREMENTS_TRACEABILITY.md)**, including what is implemented, what is deferred, and which items are blocked on external legal, CDP, or deployment decisions.

## Early Tester Programme, Bug Reporting & Contribution Rewards

KYROX is opening its **Early Tester Programme** to a small group of external builders testing the Python MCP server (`kyrox-mcp`) and its safety boundaries on Base Sepolia. The canonical programme rules, amounts, funding disclosures, and badge status are in **[BOUNTY.md](BOUNTY.md)**.

- **Active rewards:** Bug Bounty **$10–$50 USDC** per confirmed, reproducible bug; First Integrations **$25 USDC** each for the first **6** qualifying integrations (**$150 USDC** maximum planned allocation).
- **Future rewards (not active on Day 13):** Feature Idea That Ships **$50 USDC** from Day 14; Community Challenge **$150 USDC** split across the top 3 from Chapter 2, Week 2.
- **Funding status:** The **$400 USDC** programme pool is a suggested playbook budget only. It is **not confirmed as escrowed**, the payout network/treasury is **unconfirmed**, and legal/tax review is **pending**. Do not assume Base Sepolia is the payout network.
- **Early Builder badge:** Free, non-transferable, onchain recognition badge — **planned/pending deployment**, with no token, airdrop, or monetary value.
- **Reporting:** Use the [bug report form](.github/ISSUE_TEMPLATE/bug_report.yml) for reproducible non-security issues. Report security vulnerabilities privately through [SECURITY.md](SECURITY.md); never post exploit details, private keys, seed phrases, or `.env` contents publicly.

The root **[BOUNTY.md](BOUNTY.md)** is canonical for this unified repository. [`services/mcp-server/BOUNTY.md`](services/mcp-server/BOUNTY.md) is preserved for package provenance; it does not activate additional or conflicting rewards.

## Monorepo Architecture & Directory Structure

```text
kyrox/
├── apps/
│   ├── web/                    Next.js App Router consumer application (@kyrox/web)
│   └── marketing/              Standalone static Next.js marketing website (@kyrox/marketing)
├── packages/
│   ├── core/                   Canonical TypeScript quote math, trade policy, decimals & types (@kyrox/core)
│   ├── protocol/               Exchange ABI, chain identity, deployment plan & verification (@kyrox/protocol)
│   ├── db/                     Drizzle PostgreSQL schema and migrations 0000–0005 (@kyrox/db)
│   └── contracts/              Foundry Solidity contracts (KyroxExchange, TestStock, TestUSDC) & tests
├── services/
│   ├── mcp-server/             Standalone Python 3.11+ FastMCP STDIO server (kyrox-mcp v0.1.0)
│   ├── price/                  Read-only Chainlink adapter, sequencer gate, ingestion & publication prep (@kyrox/price)
│   ├── trade-intent/           Quote revalidation and unsigned buy/sell intent preparation (@kyrox/trade-intent)
│   ├── agent/                  Read/quote-only consumer assistant policy scaffold (@kyrox/agent)
│   └── indexer/                Phase 2 on-chain event indexer scaffold (@kyrox/indexer)
├── video/                     Standalone demo recording/rendering tooling (outside product gates)
├── content/                    Standalone Remotion video & design projects (outside pnpm workspace)
│   ├── day-5-carousel/         Day 5 HTML/CSS/Python social carousel generator
│   ├── day-6-architecture/     Day 6 architecture SVG & Python renderer
│   ├── kyrox-product-film/     Remotion product launch film & Phase 0 completion film
│   └── kyrox-motion/           Remotion explainer ("Inside One MCP Tool Call")
├── deployments/
│   └── base-sepolia.json       Base Sepolia deployment manifest (intentionally unpopulated)
├── scripts/                    Deployment dry-run, verification, local bootstrap, Postgres/Anvil & secret scan scripts
├── docs/
│   ├── adr/                    Architecture Decision Records (0001–0011)
│   ├── ACCEPTANCE_CRITERIA.md
│   ├── BASE_SEPOLIA_DEPLOYMENT_RUNBOOK.md
│   ├── DEPLOYMENT_READINESS.md
│   ├── NETWORK_IDENTITY_EVIDENCE.md
│   ├── PLATFORM_OPERATIONS.md
│   ├── PREVIEW_DEPLOYMENT.md
│   ├── RELEASE_CHECKLIST.md
│   ├── THREAT_MODEL.md
│   ├── REQUIREMENTS_TRACEABILITY.md
│   └── UNIFIED_MIGRATION_FORENSICS.md
├── .github/
│   ├── workflows/ci.yml        Unified CI (JS/Next.js, release smoke, Python, Foundry, Content, Integration, Playwright, Secrets)
│   └── ISSUE_TEMPLATE/bug_report.yml
├── .env.example                Root environment template for TypeScript apps/services
├── BOUNTY.md                   Canonical contribution rewards, bug bounty & Early Builder programme
├── SECURITY.md                 Project-wide security policy and vulnerability disclosure
├── package.json                Root pnpm workspace scripts and devDependencies ("name": "kyrox")
├── pnpm-workspace.yaml         Workspace membership (apps/*, packages/*, services/*)
└── tsconfig.base.json          Strict shared TypeScript configuration
```

---

## Component Overview

### 1. Consumer Application (`apps/web`)

Next.js 16 App Router dashboard with server-issued nonce wallet authentication (`viem` signature recovery, hashed 256-bit HttpOnly session cookies), quote review, exact-allowance wallet approval helpers, unsigned trade intent preparation, portfolio view, and activity history.

### 2. Static Marketing Website (`apps/marketing`)

Zero-dependency Next.js static export (`output: "export"` into `apps/marketing/out/`). Has no dependency on `@kyrox/*` workspace packages, API routes, databases, RPC endpoints, wallets, or runtime secrets. Includes a Playwright viewport/accessibility/contrast validator (`apps/marketing/scripts/validate.mjs`).

### 3. Shared TypeScript Packages (`packages/*`)

- **`packages/core` (`@kyrox/core`):** Canonical TypeScript source of truth ([ADR-0002](docs/adr/0002-typescript-core-source-of-truth.md)) for `bigint`-only quote math, floor rounding, minimum-output calculation, per-asset freshness assessment, asset registry (`tAAPL`, `tNVDA`, `tMSFT`, `tGOOGL`, `tAMZN`, `tTSLA`, `tMETA`), and exchange trade policy (`1 tUSDC` min, `1,000 tUSDC` max, `5,000 tUSDC` daily limit). Shares golden vectors (`packages/core/fixtures/golden-quotes.json`) with Foundry tests.
- **`packages/protocol` (`@kyrox/protocol`):** Exchange/token ABIs, calldata encoders, deterministic intent hashing, pinned Base Sepolia chain identity verification (genesis `0x0dcc9e…34e4` and checkpoint `61,800,000` `0x486d04…d7ce`), deployment plan derivation, and manifest verification.
- **`packages/db` (`@kyrox/db`):** Drizzle ORM PostgreSQL schema and SQL migrations (`0000_price_ingestion.sql` through `0005_intent_blocks.sql`) for price observations, publication state machine, sessions, quotes, trade intents, and audit events.

### 4. Backend Services (`services/*`)

- **`services/price` (`@kyrox/price`):** Reads verified Chainlink Coinbase tokenized-equity proxies on Base Mainnet (`8453`) via `latestRoundData()`, enforces the L2 sequencer uptime feed (`0xBCF85224fc0756B9Fa45aA7892530B47e10b6433`) and 3,600-second grace period, normalizes 8-decimal feed answers to 6-decimal USDC units, persists idempotent observations with original `sourceUpdatedAt` provenance, prepares unsigned `setPrice` calldata, and verifies on-chain publication receipts.
- **`services/trade-intent` (`@kyrox/trade-intent`):** Revalidates token address, on-chain decimals, chain ID (`84532`), deadline, observation freshness, recomputed quote, and policy before encoding unsigned `buy`/`sell` calldata and a deterministic intent hash.
- **`services/agent` (`@kyrox/agent`) & `services/indexer` (`@kyrox/indexer`):** The agent boundary remains read/quote-only ([ADR-0005](docs/adr/0005-agent-tool-boundary.md)). The indexer now decodes Base Sepolia `Trade` and faucet `Claim` logs idempotently, checkpoints progress and rolls back reorged blocks.

### 5. Foundry Smart Contracts (`packages/contracts`)

| Contract            | Purpose                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `TestUSDC`          | 6-decimal settlement token; welcome and daily faucets; `EXCHANGE_ROLE`-only mint/burn                 |
| `TestStock`         | Configurable-decimal (`6`, `8`, or `18`) synthetic stock token; `EXCHANGE_ROLE`-only mint/burn        |
| `KyroxExchange`     | Fixed-reference-price mint/burn exchange, per-asset freshness and deviation guards, pause, provenance |
| `IKyroxPriceSource` | Feed-independent price observation interface                                                          |

### 6. Python MCP Server (`services/mcp-server`)

Self-contained, independently installable Python `>=3.11` (`3.13` baseline) Model Context Protocol STDIO server (`kyrox-mcp` `v0.1.0`, licensed under Apache-2.0). Exposes 7 annotated MCP tools (`hello_kyrox`, `list_stocks`, `get_stock_info`, `get_wallet_balances`, `get_portfolio`, `prepare_transaction`, `simulate_transaction`) with a developer-facing 50-token ERC-20 transfer safety policy (`tools/policy.py`), 100-digit `Decimal` portfolio arithmetic, and fail-closed redacted JSONL audit logging (`tools/log.py`).

- Includes its own playbook demonstration ERC-20 contract (`services/mcp-server/contracts/MockStock.sol`), distributed in the Python source distribution (`sdist`) and deliberately kept separate from `packages/contracts/`.
- Full documentation, Claude Desktop / Antigravity / MCP Inspector setup, and tool examples: **[services/mcp-server/README.md](services/mcp-server/README.md)**.

The durable testnet platform (admin roles/audit, indexer, quests/points/referrals, policy, analytics and data deletion) is documented in **[docs/PLATFORM_OPERATIONS.md](docs/PLATFORM_OPERATIONS.md)**.

### 7. Standalone Content Projects (`content/*`)

Kept outside `pnpm-workspace.yaml` with independent npm lockfiles (`package-lock.json`) and Python scripts:

- `content/kyrox-product-film/` — Remotion product launch film (`KyroxProductLaunchFilm`) and 38-second Phase 0 completion film (`KyroxPhase0Film`).
- `content/kyrox-motion/` — 22-second Remotion explainer (_"KYROX — Inside One MCP Tool Call"_, `KyroxInsideOneToolCall`).
- `content/day-5-carousel/` & `content/day-6-architecture/` — Slide carousel and SVG architecture diagram generators.

---

## Prerequisites

- **Node.js 24** (`.nvmrc`) & **pnpm 12.21.0** via Corepack (`corepack enable`)
- **Python 3.11+** (`3.13` recommended) for `services/mcp-server`
- **Foundry** (`forge`, `anvil`) for `packages/contracts` and Anvil E2E suites
- **PostgreSQL 16+** for the consumer app and database integration tests

---

## Local Development Setup & Testing Commands

### 1. TypeScript Workspace (`apps/*`, `packages/*`, `services/*`)

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
```

| Command                    | Purpose                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm lint`                | ESLint across the TypeScript workspace                                             |
| `pnpm format`              | Prettier write                                                                     |
| `pnpm format:check`        | Prettier check (CI)                                                                |
| `pnpm typecheck`           | Strict TypeScript check across all 9 workspace packages                            |
| `pnpm test`                | Vitest unit and cross-surface invariant drift tests                                |
| `pnpm build`               | Next.js production build for `@kyrox/web`                                          |
| `pnpm build:marketing`     | Next.js static export build for `@kyrox/marketing`                                 |
| `pnpm validate:marketing`  | Validate the served marketing export with Playwright                               |
| `pnpm check`               | Run lint, format check, typecheck, test, web build, and marketing build            |
| `pnpm migrate`             | Apply Drizzle migrations via `DIRECT_DATABASE_URL`, falling back to `DATABASE_URL` |
| `pnpm scan:secrets`        | Full-history and tracked working-tree secret scan                                  |
| `pnpm local:e2e`           | Disposable Anvil + PostgreSQL + Next.js API and Playwright acceptance journey      |
| `pnpm test:postgres`       | PostgreSQL integration suite (requires `KYROX_TEST_DATABASE_URL`)                  |
| `pnpm test:postgres:local` | Provisions a disposable `/tmp` PostgreSQL cluster and runs `test:postgres`         |
| `pnpm e2e:publication`     | Disposable PostgreSQL + Anvil rehearsal for `prepareSetPricePublication`           |
| `pnpm e2e:anvil`           | Local Anvil end-to-end buy/sell trade lifecycle test                               |

### 2. Foundry Smart Contracts (`packages/contracts`)

```bash
cd packages/contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.6.1 --no-git
forge install foundry-rs/forge-std@v1.17.0 --no-git

forge fmt --check
forge build --sizes
forge test -vvv
```

### 3. Python MCP Server (`services/mcp-server`)

```bash
cd services/mcp-server
python3 -m venv .venv
source .venv/bin/activate
PIP_BUILD_CONSTRAINT=../../docs/ci/python-build-constraints.txt \
  python -m pip install --upgrade --constraint ../../docs/ci/python-build-constraints.txt pip build setuptools wheel
python -m pip install --requirement requirements-lock.txt --constraint requirements-lock.txt ".[dev]"
python -m pip check

# Run the 402-test pytest suite (including STDIO, packaging, and cross-surface invariant smoke tests)
python -m pytest -q

# Build wheel and sdist and verify isolated wheel installation
python ../../scripts/verify-mcp-package.py
```

See [services/mcp-server/README.md](services/mcp-server/README.md) for Windows PowerShell commands, Claude Desktop / Antigravity configuration, and installing from a Git subdirectory (`pip install "git+https://github.com/SAIFew/kyrox.git#subdirectory=services/mcp-server"`).

### 4. Running the Consumer Application (`apps/web`) Locally on Anvil

```bash
# Terminal 1 (loopback only)
anvil --port 8545 --chain-id 84532

# Terminal 2: disposable PostgreSQL + migrations + local deployment + web dev server
BASE_SEPOLIA_RPC_URL=http://127.0.0.1:8545 \
KYROX_ENVIRONMENT=local-anvil AUTH_SECRET=<32+ chars> \
bash scripts/with-postgres.sh bash -c '
  pnpm migrate &&
  pnpm local:bootstrap &&
  pnpm --filter @kyrox/web dev
'
```

`pnpm local:e2e` runs the full acceptance journey through both the HTTP API and headless Chrome against temporary Anvil + PostgreSQL + Next.js, including responsive checks at `320/375/430/768/1024/1440 px`.

---

### 5. Admin and indexer operations

```bash
# Bootstrap the first admin wallet (live PostgreSQL only)
DATABASE_URL=postgres://... ADMIN_WALLET=0x... ADMIN_ROLE=owner pnpm admin:grant

# Index Base Sepolia Trade and Claim logs from the verified manifest
BASE_SEPOLIA_RPC_URL=... DATABASE_URL=... INDEXER_ONCE=1 pnpm indexer:run
```

See [docs/PLATFORM_OPERATIONS.md](docs/PLATFORM_OPERATIONS.md) for roles, checkpoints, reorg
handling, quests/referrals, policy bounds, analytics and deletion.

## Environment Configuration

- **Root [.env.example](.env.example):** Configures `@kyrox/web`, `@kyrox/db`, `@kyrox/price`, `@kyrox/trade-intent`, observability, and Base Sepolia deployment verification scripts (`KYROX_ENVIRONMENT`, `APP_ORIGIN`, `KYROX_MARKET_SESSION_MODE`, `BASE_SEPOLIA_RPC_URL`, `BASE_MAINNET_RPC_URL`, `DATABASE_URL`, `DIRECT_DATABASE_URL`, `AUTH_SECRET`, `PRICE_*`, `SEPOLIA_*`).
- **Canonical origin (`APP_ORIGIN`):** Required in live Base Sepolia mode and must be a bare HTTPS origin with no path, query, fragment, or credentials. It defines the SIWE host/URI and the exact set of accepted mutation `Origin` headers. `NEXT_PUBLIC_APP_URL` is used only as a migration fallback; local loopback origins may omit `Origin` for non-browser API clients. Preview mode without either variable falls back to the request origin so the simulated venue still works without a database or RPC.
- **Health and readiness:** `/api/healthz` is a dependency-free liveness check. `/api/readyz` returns `200` only when the signed-session secret is valid in preview mode, or when the shared PostgreSQL pool answers a bounded `SELECT 1` in live mode; failures return a generic `503` with no secrets, SQL, URLs, or driver text. The richer `/api/health` and `/api/status` probes remain available for operators.
- **Python MCP [services/mcp-server/.env.example](services/mcp-server/.env.example):** Configures `kyrox-mcp` (`BASE_RPC_URL`, `BASE_RPC_TIMEOUT`, `KYROX_STOCKS_FILE`, `KYROX_MAX_TOKEN_AMOUNT`, `KYROX_APPROVED_TICKERS`, `KYROX_ALLOWED_RECIPIENTS`, `KYROX_INTENT_TTL_SECONDS`, `KYROX_LOG_*`).
- Never place private keys, seed phrases, or live credentials in any `.env` file, and never put a secret in a `NEXT_PUBLIC_*` variable.

### Mode selection and fail-closed behavior

- The public preview intentionally uses `KYROX_DEMO_MODE=1`. Blank/unset plus an empty `DATABASE_URL` also selects preview; `0` disables that fallback and requires the full live configuration.
- Live Base Sepolia mode requires `KYROX_ENVIRONMENT=base-sepolia`, PostgreSQL, a strong `AUTH_SECRET`, a Base Sepolia RPC, and an approved deployed manifest. An unpopulated or local manifest is rejected.
- `KYROX_MARKET_SESSION_MODE=unknown` is the fail-closed default. `always-open-testnet` is an explicit testnet-only freshness-based opt-in, not a mainnet or 24/7-price claim.
- `PRICE_PUBLICATION_ENABLED=false` is enforced; invalid non-boolean values fail CLI configuration. Explicit `true` still only prepares unsigned calldata.
- `pnpm migrate` uses `DIRECT_DATABASE_URL` first and `DATABASE_URL` only as a fallback. Never point migrations at a transaction pooler.

---

## Architecture Decision Records

| ADR                                                                     | Decision                                                                                                                      |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [0001](docs/adr/0001-separate-repository.md)                            | Separate `kyrox-app` repository _(Superseded by [ADR-0011](docs/adr/0011-unified-monorepo-and-policy-surface-separation.md))_ |
| [0002](docs/adr/0002-typescript-core-source-of-truth.md)                | TypeScript `core` is the source of truth for consumer exchange quote and policy                                               |
| [0003](docs/adr/0003-fixed-reference-price-exchange.md)                 | Fixed-reference-price mint/burn exchange, no AMM                                                                              |
| [0004](docs/adr/0004-oracle-freshness-and-provenance.md)                | Preserve source timestamps and round IDs; never refresh stale prices                                                          |
| [0005](docs/adr/0005-agent-tool-boundary.md)                            | Consumer agent is read/quote only; the user wallet signs                                                                      |
| [0006](docs/adr/0006-environment-isolation.md)                          | Strict Base Sepolia write / Base Mainnet read-only isolation                                                                  |
| [0007](docs/adr/0007-workspace-layout-and-decimals.md)                  | Workspace layout and explicit token decimal policy (`6`, `8`, `18`)                                                           |
| [0008](docs/adr/0008-exchange-math-and-observation-publication.md)      | Exchange math, floor rounding, decimals, and observation provenance                                                           |
| [0009](docs/adr/0009-price-ingestion-and-intent-binding.md)             | Price ingestion worker, sequencer gate, and trade intent binding                                                              |
| [0010](docs/adr/0010-deployment-proposal-and-verification.md)           | Multi-RPC chain identity proof, deployment proposal, and activation gates                                                     |
| [0011](docs/adr/0011-unified-monorepo-and-policy-surface-separation.md) | Unified monorepo layout, policy surface separation, and shared invariant drift tests                                          |

---

## Deployment Proposal, Verification & Price Publication

- `pnpm deploy:sepolia:dry-run --json` requires two independently operated archive-capable RPCs, verifies the pinned Base Sepolia genesis (`0x0dcc9e…34e4`) and checkpoint `61,800,000` (`0x486d04…d7ce`), derives deployment order (`TestUSDC` → `TestStock` → `KyroxExchange`), constructor arguments, creation-bytecode hashes, role grants, and asset configuration from compiled artifacts, and writes `deployments/base-sepolia.proposed.json` (git-ignored, all addresses `null`). Use `--json` in shared logs: the human-output path currently prints the primary RPC URL and is pending a redaction fix outside DevOps ownership.
- `pnpm verify:sepolia-deployment` verifies externally supplied deployment evidence against two independent RPCs before writing `deployments/base-sepolia.verified-pending.json`.
- `pnpm activate:sepolia-manifest --confirm` is a separate promotion step. See [docs/BASE_SEPOLIA_DEPLOYMENT_RUNBOOK.md](docs/BASE_SEPOLIA_DEPLOYMENT_RUNBOOK.md) and [docs/DEPLOYMENT_READINESS.md](docs/DEPLOYMENT_READINESS.md) (not executed).
- `pnpm price:ingest` verifies the Base Mainnet L2 sequencer, reads approved Chainlink feeds, and persists observations. It prepares unsigned `setPrice` calldata only when `PRICE_PUBLICATION_ENABLED=true`; the enforced default is `false`. `pnpm price:verify-publication --asset tAAPL --round 123 --tx-hash 0x...` verifies on-chain publication receipts and confirmation depth.

---

## Unified Continuous Integration (`.github/workflows/ci.yml`)

Every pull request and push to `main` runs nine jobs:

1. **JavaScript (`javascript`):** Node 24 + pnpm 12.21.0 frozen install, ESLint, Prettier check, TypeScript typecheck across all product workspaces, Vitest unit + cross-surface invariant tests, a no-RPC deployment CLI refusal check, `@kyrox/web` production build, server-trace manifest verification, `@kyrox/marketing` static export, and the Playwright marketing validator.
2. **Release readiness (`release-readiness`):** Uses disposable PostgreSQL to exercise `pnpm migrate` through `DIRECT_DATABASE_URL`, builds the consumer app in explicit live mode against a temporary non-destructive manifest, and smoke-tests health plus database-backed assets without external RPC access.
3. **Python MCP (`python`, matrix `3.11`, `3.12`, `3.13`):** Combines pinned build-tool constraints with `requirements-lock.txt`, runs `pip check` and `pytest`, builds wheel/sdist archives, installs the wheel into an isolated temporary virtual environment, and runs a STDIO JSON-RPC smoke test.
4. **Foundry Contracts (`contracts`):** Verifies contract sources exist, installs pinned OpenZeppelin (`v5.6.1`) and `forge-std` (`v1.17.0`), and runs `forge fmt --check`, `forge build --sizes`, and `forge test -vvv`.
5. **Standalone Content (`content`):** Validates `content/kyrox-product-film` and `content/kyrox-motion` with `npm ci` + `tsc --noEmit`, and checks Python scripts and SVG/HTML assets in `content/day-5-carousel` and `content/day-6-architecture`.
6. **PostgreSQL & Anvil Integration (`integration`):** Runs against a `postgres:16-alpine` service container and Foundry `anvil` to execute the 10 integration/E2E tests (`postgres.integration.test.ts`, `publication.e2e.test.ts`, and `e2e.anvil.test.ts`).
7. **Consumer Playwright (`consumer-e2e`):** Runs the full local Anvil + disposable PostgreSQL + Next.js API and browser acceptance journey, including six responsive viewports, and uploads Playwright artifacts on failure.
8. **Cross-surface (`cross-surface`):** Installs the locked Python MCP runtime and runs canonical TypeScript/Python policy drift plus secret-scanner regression tests.
9. **Secrets (`secrets`):** Scans tracked files and full Git history, then safely scans non-ignored untracked text files up to 2 MiB. Findings contain only paths, line numbers, rule IDs, and fingerprints—never matched values.

### Product and media gate policy

Root ESLint and Prettier gates cover product source in `apps/`, `packages/`, `services/`, and root tooling. Standalone `content/` and `video/` media tooling are explicitly excluded from those root gates so generated or work-in-progress media cannot mask or break product checks; committed content projects retain their dedicated CI validation. `.vercelignore` excludes both media trees and generated audio/video formats from web deployments. Product source is never excluded.

---

## What Is Not Implemented Yet

- Base Sepolia contract deployment, live price publication, an exchange-market calendar, or CDP embedded wallets.
- Durable event indexer (`services/indexer`, Phase 2) and consumer agent tools (`services/agent`, Phase 4); both remain scaffolds.
- Production-grade distributed rate limiting (currently in-memory), trusted-proxy handling, and MFA/admin UI.
- Remote HTTP/SSE transport for `services/mcp-server` (currently local STDIO only).

---

## Documentation & Security

- [Security policy & vulnerability reporting](SECURITY.md) ([Python MCP security policy](services/mcp-server/SECURITY.md))
- [Contribution rewards, bug bounty & Early Builder programme](BOUNTY.md)
- [Unified migration forensics](docs/UNIFIED_MIGRATION_FORENSICS.md)
- [Acceptance criteria](docs/ACCEPTANCE_CRITERIA.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Deployment readiness](docs/DEPLOYMENT_READINESS.md) & [Base Sepolia deployment runbook](docs/BASE_SEPOLIA_DEPLOYMENT_RUNBOOK.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md) & [Preview deployment notes](docs/PREVIEW_DEPLOYMENT.md)
- [Network identity evidence](docs/NETWORK_IDENTITY_EVIDENCE.md)
- [Architecture decision records](docs/adr/)

## Licensing

- **Repository Root & Application Workspace:** Private repository; no blanket root open-source licence file is applied. See the repository owner for licensing terms.
- **Python MCP Server (`services/mcp-server/`):** Licensed under the **Apache License, Version 2.0** (`Apache-2.0`); see [services/mcp-server/LICENSE](services/mcp-server/LICENSE).
