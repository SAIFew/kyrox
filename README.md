# KYROX App

Consumer application for the KYROX Base Sepolia testnet MVP.

> **Status: Phase 0 — architecture freeze and scaffold.**
> No trading, no wallet connection, no database, and no deployed contracts yet.
> Testnet only. No real-money trading.

This repository is intentionally separate from [`kyrox-mcp`](../kyro-mcp), which
remains the Python MCP server and will eventually become an adapter to this
application's API.

## Repository structure

```text
kyrox-app/
├── apps/
│   └── web/                    Next.js App Router consumer application
├── packages/
│   ├── core/                   Deterministic quote, policy, decimals, types
│   ├── db/                     Drizzle schema and PostgreSQL access
│   └── contracts/              Foundry contracts (none yet)
├── services/
│   ├── agent/                  Read/quote-only LLM tool orchestration
│   ├── indexer/                Onchain event indexing
│   └── price/                  Oracle ingestion with provenance
├── deployments/
│   └── base-sepolia.json       Verified addresses (intentionally unpopulated)
├── docs/
│   ├── adr/                    Architecture decision records
│   ├── ACCEPTANCE_CRITERIA.md
│   └── THREAT_MODEL.md
├── .github/workflows/ci.yml
├── .env.example
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Prerequisites

- Node.js 24 (`.nvmrc`)
- pnpm 12 via Corepack (`corepack enable`)
- Foundry for contract work (`forge`), only needed inside `packages/contracts`
- PostgreSQL for the database milestone

## Setup

```bash
corepack enable
pnpm install
cp .env.example .env.local
pnpm dev --filter @kyrox/web
```

The app starts without any environment variables because Phase 0 performs no
network or database work.

## Scripts

| Command             | Purpose                                   |
| ------------------- | ----------------------------------------- |
| `pnpm lint`         | ESLint over the workspace                 |
| `pnpm format`       | Prettier write                            |
| `pnpm format:check` | Prettier check (CI)                       |
| `pnpm typecheck`    | Strict TypeScript check for every package |
| `pnpm test`         | Vitest across packages and services       |
| `pnpm build`        | Next.js production build                  |
| `pnpm check`        | All of the above                          |

Contracts:

```bash
cd packages/contracts
forge fmt --check
forge build
forge test
```

## Architecture decisions

| ADR                                                      | Decision                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| [0001](docs/adr/0001-separate-repository.md)             | Separate `kyrox-app` repository and MCP adapter boundary             |
| [0002](docs/adr/0002-typescript-core-source-of-truth.md) | TypeScript `core` is the source of truth for quote and policy        |
| [0003](docs/adr/0003-fixed-reference-price-exchange.md)  | Fixed-reference-price mint/burn exchange, no AMM                     |
| [0004](docs/adr/0004-oracle-freshness-and-provenance.md) | Preserve source timestamps and round ids; never refresh stale prices |
| [0005](docs/adr/0005-agent-tool-boundary.md)             | Agent is read/quote only; the user wallet signs                      |
| [0006](docs/adr/0006-environment-isolation.md)           | Strict Sepolia/mainnet separation                                    |
| [0007](docs/adr/0007-workspace-layout-and-decimals.md)   | Workspace layout and explicit decimal policy                         |

## Safety boundaries

- Base Sepolia only (`chainId 84532`). No mainnet switching.
- The user's wallet is the only transaction signer.
- The AI cannot sign, execute, transfer, or construct arbitrary calldata.
- Quotes are computed deterministically and rechecked at approval.
- Oracle freshness uses the original `updatedAt`, never a rewritten timestamp.
- No Base Mainnet address is valid in Sepolia configuration.
- No secret is exposed through `NEXT_PUBLIC_*`.

## CI

`.github/workflows/ci.yml` runs two jobs:

1. **JavaScript:** install, lint, format check, type-check, test, Next.js build.
2. **Contracts:** `forge fmt --check`, then build and test only when Solidity
   sources exist.

## What Phase 0 does not include

- Wallet connection, CDP login, or trading UI.
- Database tables or migrations.
- Contracts, scripts, or deployments.
- Indexer or price ingestion logic.
- Admin, quests, referrals, or analytics.
- Any change to the `kyrox-mcp` repository.

## Documentation

- [Acceptance criteria](docs/ACCEPTANCE_CRITERIA.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Architecture decision records](docs/adr/)

## Licence

See the repository owner for licensing. No licence file is added in Phase 0.
