# KYROX App

Consumer application for the KYROX Base Sepolia testnet MVP.

> **Status: Phase 1 complete locally; consumer vertical slice running on local Anvil.**
> Deterministic quote/policy engine, testnet contracts, a read-only Chainlink
> feed adapter, durable observation schema, an idempotent ingestion worker,
> unsigned publication/intent preparation, and a wallet-authenticated consumer
> dashboard are implemented and tested locally. No Base Sepolia deployment and
> no live price publication exist. Testnet only. No real-money trading.

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
│   ├── protocol/               Exchange ABI, manifests, calldata, intent hash
│   └── contracts/              Foundry contracts + shared golden vectors
├── services/
│   ├── agent/                  Read/quote-only policy scaffold (no tools yet)
│   ├── indexer/                Phase 2 scaffold (no event handlers yet)
│   ├── price/                  Chainlink read adapter, ingestion, publication prep
│   └── trade-intent/           Quote revalidation and unsigned intent preparation
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
- PostgreSQL for the consumer app and integration tests

## Setup

```bash
corepack enable
pnpm install
cp .env.example .env.local
pnpm dev --filter @kyrox/web
```

Local mode requires `DATABASE_URL`, `AUTH_SECRET` (32+ characters), a loopback
`BASE_SEPOLIA_RPC_URL`, and a `deployments/local-anvil.json` manifest. See
`.env.example` for the full list of names.

## Scripts

| Command              | Purpose                                   |
| -------------------- | ----------------------------------------- |
| `pnpm lint`          | ESLint over the workspace                 |
| `pnpm format`        | Prettier write                            |
| `pnpm format:check`  | Prettier check (CI)                       |
| `pnpm typecheck`     | Strict TypeScript check for every package |
| `pnpm test`          | Vitest across packages and services       |
| `pnpm build`         | Next.js production build                  |
| `pnpm check`         | All of the above                          |
| `pnpm e2e:anvil`     | Local Anvil end-to-end trade suite        |
| `pnpm test:postgres` | PostgreSQL integration suite (needs DB)   |

Contracts (Foundry is only needed inside `packages/contracts`):

```bash
cd packages/contracts
# install pinned dependencies (lib/ is git-ignored)
forge install OpenZeppelin/openzeppelin-contracts@v5.6.1 --no-git
forge install foundry-rs/forge-std@v1.17.0 --no-git

forge fmt --check
forge build --sizes
forge test -vvv
```

The exchange and the TypeScript core are checked against the same vectors in
`packages/core/fixtures/golden-quotes.json`.

## Architecture decisions

| ADR                                                                | Decision                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| [0001](docs/adr/0001-separate-repository.md)                       | Separate `kyrox-app` repository and MCP adapter boundary             |
| [0002](docs/adr/0002-typescript-core-source-of-truth.md)           | TypeScript `core` is the source of truth for quote and policy        |
| [0003](docs/adr/0003-fixed-reference-price-exchange.md)            | Fixed-reference-price mint/burn exchange, no AMM                     |
| [0004](docs/adr/0004-oracle-freshness-and-provenance.md)           | Preserve source timestamps and round ids; never refresh stale prices |
| [0005](docs/adr/0005-agent-tool-boundary.md)                       | Agent is read/quote only; the user wallet signs                      |
| [0006](docs/adr/0006-environment-isolation.md)                     | Strict Sepolia/mainnet separation                                    |
| [0007](docs/adr/0007-workspace-layout-and-decimals.md)             | Workspace layout and explicit decimal policy                         |
| [0008](docs/adr/0008-exchange-math-and-observation-publication.md) | Exchange math, floor rounding, decimals, observation provenance      |

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
2. **Contracts:** install pinned OpenZeppelin and forge-std, then
   `forge fmt --check`, `forge build --sizes`, and `forge test -vvv` when
   Solidity sources exist.

## Core trading engine

`packages/core` implements, with `bigint` only:

- asset definitions and an allowlist registry;
- price observations with source round id, source timestamp and provenance;
- per-asset freshness assessment that never rewrites the source timestamp;
- buy/sell quote math with explicit floor rounding;
- minimum-output calculation;
- a deterministic policy engine (1 tUSDC minimum, 1,000 tUSDC maximum,
  5,000 tUSDC daily limit, allowlist, pause, freshness, expiry).

## Contracts

| Contract            | Purpose                                                                        |
| ------------------- | ------------------------------------------------------------------------------ |
| `TestUSDC`          | 6-decimal settlement token; welcome and daily faucets; exchange-only mint/burn |
| `TestStock`         | Configurable-decimal stock token; exchange-only mint/burn                      |
| `KyroxExchange`     | Fixed-reference-price mint/burn, per-asset freshness, pause, provenance        |
| `IKyroxPriceSource` | Feed-independent observation interface                                         |

No contract is deployed. `deployments/base-sepolia.json` is intentionally empty.

## Price ingestion and intent preparation

`services/price` reads verified Chainlink Coinbase tokenized-equity proxies on
Base Mainnet (`8453`) through `latestRoundData()`, normalizes the 8-decimal
answer to 6-decimal USDC units with integer math, and stores every observation
with its original `sourceUpdatedAt` and a separate `observedAt`. The worker is
idempotent, restart-safe, and never fabricates a new round.

Publication preparation encodes an unsigned `setPrice` call and refuses when no
Base Sepolia deployment manifest exists. `services/trade-intent` revalidates the
token address, on-chain decimals, chain, deadline, observation, recomputed
quote, and policy before encoding unsigned `buy`/`sell` calldata and a
deterministic intent hash. Neither service contains a signer or a submission
path.

See [ADR-0009](docs/adr/0009-price-ingestion-and-intent-binding.md) and
[ADR-0010](docs/adr/0010-deployment-proposal-and-verification.md).

## Deployment proposal and verification

`pnpm deploy:sepolia:dry-run` requires two independently operated archive RPCs,
pins the Base Sepolia genesis (`0x0dcc9e…34e4`) and checkpoint 61,800,000
(`0x486d04…d7ce`), derives
deployment order, constructor arguments, creation-bytecode hashes, role grants
and asset configuration from compiled artifacts, and writes
`deployments/base-sepolia.proposed.json`. It sends no transaction, instantiates
no wallet and leaves every address `null`. The proposal intentionally fails the
production manifest validator.

The full operator procedure, including hardware-wallet commands, is in
[docs/BASE_SEPOLIA_DEPLOYMENT_RUNBOOK.md](docs/BASE_SEPOLIA_DEPLOYMENT_RUNBOOK.md).
It has not been executed.

`pnpm verify:sepolia-deployment` verifies externally supplied evidence
(receipts, runtime bytecode with immutables masked, constructor arguments, token
metadata, roles and asset configuration) and only then writes a pending record.
`pnpm activate:sepolia-manifest --confirm` is a separate, guarded promotion step.

Production verification requires `environment=base-sepolia`,
`status=deployed`, pinned chain identity, the confirmation threshold and the
publication artifact hash. Local Anvil verification uses an explicit,
test-only mode and cannot be selected by the production CLI.

`pnpm price:verify-publication --asset tAAPL --round 123 --tx-hash 0x...` loads
the prepared publication, checks the approved manifest and chain, decodes the
transaction and `PriceSet` event, reads `observation(token)`, compares every
field, and records lifecycle state only after the confirmation threshold.
A receipt alone is never accepted as proof.

## Local verification

Two local-only suites exercise code paths that unit tests cannot:

- `pnpm e2e:anvil` runs a buy/sell lifecycle against a temporary Anvil chain
  (chain id 84532, loopback only) using unlocked disposable accounts.
- `pnpm e2e:publication` runs the real `prepareSetPricePublication` path,
  executes the prepared calldata, and reads the observation back through
  `observation(token)`. It publishes an explicitly **simulated** observation
  with a zero feed address and writes `deployments/local-anvil.json`, which is
  git-ignored and clearly marked local-only.

Neither suite is a live Chainlink integration test. Real ingestion is covered by
the read-only feed adapter and sequencer gate; the publication rehearsal only
proves the publication plumbing.

`pnpm price:ingest` is the operational one-shot: it verifies the sequencer,
reads the approved Base Mainnet feeds, persists observations, and prepares
unsigned `setPrice` calldata for the latest valid round. With the Base Sepolia
manifest still unpopulated it reports ingestion success and publication blocked;
it never signs or broadcasts.

`pnpm test:postgres:local` provisions a temporary PostgreSQL cluster under
`/tmp`, creates a dedicated role and database with a runtime-generated password,
applies the real migrations, runs the integration suite, then stops the server
and deletes the cluster.

## Consumer application (local vertical slice)

`apps/web` is a Next.js App Router dashboard with wallet authentication, quote
review, wallet-approved execution, portfolio and activity.

```bash
# terminal 1 (loopback only)
anvil --port 8545 --chain-id 84532

# terminal 2: disposable PostgreSQL + migrations + local deployment + app
BASE_SEPOLIA_RPC_URL=http://127.0.0.1:8545 \
KYROX_ENVIRONMENT=local-anvil AUTH_SECRET=<32+ chars> \
bash scripts/with-postgres.sh bash -c '
  pnpm --filter @kyrox/db exec drizzle-kit migrate &&
  pnpm local:bootstrap &&
  pnpm --filter @kyrox/web dev
'
```

The browser wallet must be configured for Base Sepolia chain id 84532; the
dashboard offers to add the local RPC. Prices and trades are labelled simulated
and exist only on Anvil. `pnpm local:e2e` runs the full acceptance journey
through both the HTTP API and headless Chrome, against temporary Anvil +
PostgreSQL + Next, including responsive checks at 320/375/430/768/1024/1440 px.

Operational alerts required before any external beta: feed failures, sequencer
downtime/grace, stale observations, publication verification failures, intent
reorgs and API error rates. Events are written to `app_events` and stdout.

## Consumer application security

- Wallet ownership is proven by a server-issued one-time nonce and a signature
  recovered with viem; the address in the request is never trusted alone.
- Sessions are random 256-bit tokens stored hashed, delivered as HttpOnly,
  SameSite=Lax cookies, expiring after one hour.
- Quotes are HMAC-bound to the wallet, asset, amounts, observation and expiry;
  preparation recomputes with a server clock and trusted policy state.
- Mutating endpoints enforce same-origin checks and rate limits.
- Local mode only accepts loopback RPC and a `local-anvil` manifest; production
  mode rejects it, and vice versa.
- The UI labels simulated prices and never shows an unsigned intent as executed.

## What is not implemented yet

- Base Sepolia deployment, live price publication, or CDP embedded wallets.
- Durable event indexer (Phase 2) and agent tools (Phase 4); both are scaffolds.
- Production-grade rate limiting (in-memory only), trusted-proxy handling, and MFA/admin.
- Quests, referrals, analytics, and external monitoring services.
- Any change to the `kyrox-mcp` repository.

## Documentation

- [Acceptance criteria](docs/ACCEPTANCE_CRITERIA.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Architecture decision records](docs/adr/)

## Licence

See the repository owner for licensing. No licence file is added in Phase 0.
