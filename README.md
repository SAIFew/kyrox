# KYROX

Unified monorepo for the **KYROX** Base Sepolia testnet platform: consumer web application, static marketing website, deterministic TypeScript quote and policy core, price ingestion and trade-intent services, Foundry smart contracts, Python Model Context Protocol (MCP) server, and standalone Remotion media projects.

> **Current Status (Base Sepolia Testnet Only — `chainId: 84532`):**
>
> - **TypeScript Application & Foundry Contracts:** Phase 1 complete locally; consumer vertical slice running on local Anvil + PostgreSQL (`304` unit and cross-surface invariant tests + `11` PostgreSQL/Anvil integration tests + `92` Foundry contract tests passing). No Base Sepolia contract deployment and no live price publication exist yet (`deployments/base-sepolia.json` is `"status": "unpopulated"`).
> - **Python MCP Server (`services/mcp-server`):** `v0.1.0` complete (`7` registered STDIO MCP tools, deterministic 50-token transfer policy gate, fail-closed redacted JSONL audit logging, installable wheel/sdist, and `400` automated pytest tests passing).
> - **Non-Custodial Boundary:** Testnet and local mock/Anvil fixtures only. No component holds private keys, signs transactions, broadcasts transactions, or supports real-money trading.

---

## Public Preview (deployed)

The consumer application ships with a first-class **simulated preview** mode. It runs without PostgreSQL, a loopback Anvil node, or a deployed exchange, and every price, balance, and fill is labelled `simulated` in the interface.

- **Market data:** deterministic, time-based reference curves for `tAAPL`, `tTSLA`, and `tNVDA`. No oracle is contacted. History, 24h ranges, volume, and freshness are generated locally.
- **Accounts:** an HMAC-sealed, HttpOnly preview session with simulated balances. Wallet sign-in is also supported: the wallet signature is verified, while the portfolio stays simulated and explicitly labelled.
- **Trading:** quotes run through the same `@kyrox/core` integer maths and `TESTNET_TRADE_POLICY` used by the contract tests. The review step shows price, output, minimum received, expiry, and daily limit. Confirming a preview fill updates the local session only; no calldata is built and nothing is broadcast.
- **Agent bridge:** `POST /api/mcp` is a read-only MCP (JSON-RPC 2.0) endpoint exposing `kyrox_list_markets`, `kyrox_get_market`, `kyrox_preview_quote`, and `kyrox_get_protocol_status`. It has no sign, send, transfer, or arbitrary-calldata tool.
- **Status:** `/status` and `/api/status` report contract, publication, and indexer state honestly, including what is not deployed.

Enable it explicitly with `KYROX_DEMO_MODE=1` and at least one 32-character secret in `AUTH_SECRET` (or `KYROX_DEMO_SECRET`). When `KYROX_DEMO_MODE` is unset and `DATABASE_URL` is empty, the same mode is used automatically so a fresh deployment is immediately usable. The Vercel project uses this mode; a PostgreSQL-backed Base Sepolia deployment can be enabled later by providing `DATABASE_URL`, an approved `deployments/base-sepolia.json`, and `KYROX_DEMO_MODE=0`.

### Preview routes

| Route               | Purpose                                                         |
| ------------------- | --------------------------------------------------------------- |
| `/`                 | Product landing page with live preview market cards             |
| `/markets`          | Searchable, sortable market explorer                            |
| `/markets/[symbol]` | Price history, provenance, position, and order review           |
| `/portfolio`        | Simulated balances, allocation, 24h movement, recent activity   |
| `/activity`         | Fill and intent history with explicit status labels             |
| `/developers`       | MCP configuration, tool catalogue, and live JSON-RPC playground |
| `/status`           | Environment, service, and deployment transparency               |
| `/legal`            | Preview risk disclosure                                         |
| `/api/mcp`          | Read-only MCP bridge (GET metadata, POST JSON-RPC)              |

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
│   └── THREAT_MODEL.md
├── .github/
│   ├── workflows/ci.yml        Unified CI (JS/Next.js, Python 3.11–3.13, Foundry, Content, Integration, Secrets)
│   └── ISSUE_TEMPLATE/bug_report.yml
├── .env.example                Root environment template for TypeScript apps/services
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

- **`packages/core` (`@kyrox/core`):** Canonical TypeScript source of truth ([ADR-0002](docs/adr/0002-typescript-core-source-of-truth.md)) for `bigint`-only quote math, floor rounding, minimum-output calculation, per-asset freshness assessment, asset registry (`tAAPL`, `tTSLA`, `tNVDA`), and exchange trade policy (`1 tUSDC` min, `1,000 tUSDC` max, `5,000 tUSDC` daily limit). Shares golden vectors (`packages/core/fixtures/golden-quotes.json`) with Foundry tests.
- **`packages/protocol` (`@kyrox/protocol`):** Exchange/token ABIs, calldata encoders, deterministic intent hashing, pinned Base Sepolia chain identity verification (genesis `0x0dcc9e…34e4` and checkpoint `61,800,000` `0x486d04…d7ce`), deployment plan derivation, and manifest verification.
- **`packages/db` (`@kyrox/db`):** Drizzle ORM PostgreSQL schema and SQL migrations (`0000_price_ingestion.sql` through `0005_intent_blocks.sql`) for price observations, publication state machine, sessions, quotes, trade intents, and audit events.

### 4. Backend Services (`services/*`)

- **`services/price` (`@kyrox/price`):** Reads verified Chainlink Coinbase tokenized-equity proxies on Base Mainnet (`8453`) via `latestRoundData()`, enforces the L2 sequencer uptime feed (`0xBCF85224fc0756B9Fa45aA7892530B47e10b6433`) and 3,600-second grace period, normalizes 8-decimal feed answers to 6-decimal USDC units, persists idempotent observations with original `sourceUpdatedAt` provenance, prepares unsigned `setPrice` calldata, and verifies on-chain publication receipts.
- **`services/trade-intent` (`@kyrox/trade-intent`):** Revalidates token address, on-chain decimals, chain ID (`84532`), deadline, observation freshness, recomputed quote, and policy before encoding unsigned `buy`/`sell` calldata and a deterministic intent hash.
- **`services/agent` (`@kyrox/agent`) & `services/indexer` (`@kyrox/indexer`):** Explicit scaffolds for the read/quote-only consumer assistant ([ADR-0005](docs/adr/0005-agent-tool-boundary.md)) and Phase 2 durable event indexer.

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

| Command                    | Purpose                                                                    |
| -------------------------- | -------------------------------------------------------------------------- |
| `pnpm lint`                | ESLint across the TypeScript workspace                                     |
| `pnpm format`              | Prettier write                                                             |
| `pnpm format:check`        | Prettier check (CI)                                                        |
| `pnpm typecheck`           | Strict TypeScript check across all 9 workspace packages                    |
| `pnpm test`                | Vitest unit and cross-surface invariant drift tests                        |
| `pnpm build`               | Next.js production build for `@kyrox/web`                                  |
| `pnpm build:marketing`     | Next.js static export build for `@kyrox/marketing`                         |
| `pnpm check`               | Run lint, format check, typecheck, test, web build, and marketing build    |
| `pnpm scan:secrets`        | Full-history and working-tree secret scan                                  |
| `pnpm test:postgres`       | PostgreSQL integration suite (requires `KYROX_TEST_DATABASE_URL`)          |
| `pnpm test:postgres:local` | Provisions a disposable `/tmp` PostgreSQL cluster and runs `test:postgres` |
| `pnpm e2e:publication`     | Disposable PostgreSQL + Anvil rehearsal for `prepareSetPricePublication`   |
| `pnpm e2e:anvil`           | Local Anvil end-to-end buy/sell trade lifecycle test                       |

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
python -m pip install --upgrade pip build
python -m pip install ".[dev]"
python -m pip check

# Run the 400-test pytest suite (including STDIO, packaging, and cross-surface invariant smoke tests)
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
  pnpm --filter @kyrox/db exec drizzle-kit migrate &&
  pnpm local:bootstrap &&
  pnpm --filter @kyrox/web dev
'
```

`pnpm local:e2e` runs the full acceptance journey through both the HTTP API and headless Chrome against temporary Anvil + PostgreSQL + Next.js, including responsive checks at `320/375/430/768/1024/1440 px`.

---

## Environment Configuration

- **Root [.env.example](.env.example):** Configures `@kyrox/web`, `@kyrox/db`, `@kyrox/price`, `@kyrox/trade-intent`, observability, and Base Sepolia deployment verification scripts (`KYROX_ENVIRONMENT`, `BASE_SEPOLIA_RPC_URL`, `BASE_MAINNET_RPC_URL`, `DATABASE_URL`, `AUTH_SECRET`, `PRICE_*`, `SEPOLIA_*`).
- **Python MCP [services/mcp-server/.env.example](services/mcp-server/.env.example):** Configures `kyrox-mcp` (`BASE_RPC_URL`, `BASE_RPC_TIMEOUT`, `KYROX_STOCKS_FILE`, `KYROX_MAX_TOKEN_AMOUNT`, `KYROX_APPROVED_TICKERS`, `KYROX_ALLOWED_RECIPIENTS`, `KYROX_INTENT_TTL_SECONDS`, `KYROX_LOG_*`).
- Never place private keys, seed phrases, or live credentials in any `.env` file, and never put a secret in a `NEXT_PUBLIC_*` variable.

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

- `pnpm deploy:sepolia:dry-run` requires two independently operated archive RPCs, verifies the pinned Base Sepolia genesis (`0x0dcc9e…34e4`) and checkpoint `61,800,000` (`0x486d04…d7ce`), derives deployment order (`TestUSDC` → `TestStock` → `KyroxExchange`), constructor arguments, creation-bytecode hashes, role grants, and asset configuration from compiled artifacts, and writes `deployments/base-sepolia.proposed.json` (git-ignored, all addresses `null`).
- `pnpm verify:sepolia-deployment` verifies externally supplied deployment evidence against two independent RPCs before writing `deployments/base-sepolia.verified-pending.json`.
- `pnpm activate:sepolia-manifest --confirm` is a separate promotion step. See [docs/BASE_SEPOLIA_DEPLOYMENT_RUNBOOK.md](docs/BASE_SEPOLIA_DEPLOYMENT_RUNBOOK.md) and [docs/DEPLOYMENT_READINESS.md](docs/DEPLOYMENT_READINESS.md) (not executed).
- `pnpm price:ingest` verifies the Base Mainnet L2 sequencer, reads approved Chainlink feeds, persists observations, and prepares unsigned `setPrice` calldata. `pnpm price:verify-publication --asset tAAPL --round 123 --tx-hash 0x...` verifies on-chain publication receipts and confirmation depth.

---

## Unified Continuous Integration (`.github/workflows/ci.yml`)

Every pull request and push to `main` runs six jobs:

1. **JavaScript (`javascript`):** Node 24 + pnpm 12.21.0 frozen install, ESLint, Prettier check, TypeScript typecheck across all 9 packages, Vitest unit + cross-surface invariant tests, `@kyrox/web` production build, and `@kyrox/marketing` static export build.
2. **Python MCP (`python`, matrix `3.11`, `3.12`, `3.13`):** Installs `services/mcp-server`, runs `pip check`, executes the 400-test `pytest` suite, builds wheel and sdist archives, installs the wheel into an isolated temporary virtual environment outside the repository, and runs a live STDIO JSON-RPC smoke test.
3. **Foundry Contracts (`contracts`):** Verifies contract sources exist, installs pinned OpenZeppelin (`v5.6.1`) and `forge-std` (`v1.17.0`), and runs `forge fmt --check`, `forge build --sizes`, and `forge test -vvv`.
4. **Standalone Content (`content`):** Validates `content/kyrox-product-film` and `content/kyrox-motion` with `npm ci` + `tsc --noEmit`, and checks Python scripts and SVG/HTML assets in `content/day-5-carousel` and `content/day-6-architecture`.
5. **PostgreSQL & Anvil Integration (`integration`):** Runs against a `postgres:16-alpine` service container and Foundry `anvil` to execute all 11 integration and E2E tests (`postgres.integration.test.ts`, `publication.e2e.test.ts`, and `e2e.anvil.test.ts`).
6. **Full-History Secret Scan (`secrets`):** Scans all tracked files and full Git commit history (`fetch-depth: 0`) via `node scripts/scan-secrets.mjs`.

---

## What Is Not Implemented Yet

- Base Sepolia contract deployment, live price publication, or CDP embedded wallets.
- Durable event indexer (`services/indexer`, Phase 2) and consumer agent tools (`services/agent`, Phase 4); both remain scaffolds.
- Production-grade distributed rate limiting (currently in-memory), trusted-proxy handling, and MFA/admin UI.
- Remote HTTP/SSE transport for `services/mcp-server` (currently local STDIO only).

---

## Documentation & Security

- [Security policy & vulnerability reporting](SECURITY.md) ([Python MCP security policy](services/mcp-server/SECURITY.md))
- [Acceptance criteria](docs/ACCEPTANCE_CRITERIA.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Deployment readiness](docs/DEPLOYMENT_READINESS.md) & [Base Sepolia deployment runbook](docs/BASE_SEPOLIA_DEPLOYMENT_RUNBOOK.md)
- [Network identity evidence](docs/NETWORK_IDENTITY_EVIDENCE.md)
- [Architecture decision records](docs/adr/)

## Licensing

- **Repository Root & Application Workspace:** Private repository; no blanket root open-source licence file is applied. See the repository owner for licensing terms.
- **Python MCP Server (`services/mcp-server/`):** Licensed under the **Apache License, Version 2.0** (`Apache-2.0`); see [services/mcp-server/LICENSE](services/mcp-server/LICENSE).
