# KYROX — Product acceptance criteria

Version: Phase 0 freeze (2026-11-21)

Each criterion is testable. "Phase 0" means the scaffold itself is the
deliverable; later phases turn the criterion into executable acceptance tests.

## A. Phase 0 gate (this milestone)

| ID    | Criterion                                                                 | Verification                                       |
| ----- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| P0-1  | `kyrox-app` exists as a separate repository and `kyrox-mcp` is unmodified | Git status in both repositories                    |
| P0-2  | pnpm workspace contains `apps/web`, `packages/*`, `services/*`            | `pnpm-workspace.yaml`, directory inspection        |
| P0-3  | TypeScript strict mode is enabled for every package                       | `tsconfig.base.json`, `pnpm typecheck`             |
| P0-4  | Lint, format, type-check, tests, and build pass                           | `pnpm check` locally and CI                        |
| P0-5  | Foundry is configured and no contract is deployed                         | `foundry.toml`, empty `src/`, unpopulated manifest |
| P0-6  | ADRs 0001–0007 are present                                                | `docs/adr/`                                        |
| P0-7  | Threat model and acceptance criteria are present                          | `docs/`                                            |
| P0-8  | `.env.example` contains names and descriptions only                       | manual review, no secret values                    |
| P0-9  | CI runs lint, format, type-check, test, build, and Foundry checks         | `.github/workflows/ci.yml`                         |
| P0-10 | `deployments/base-sepolia.json` contains no addresses                     | JSON review                                        |

## B. Safety invariants (must never regress)

| ID   | Invariant                                                                           | Verification                                        |
| ---- | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| S-1  | The user's wallet is the only transaction signer                                    | code review; no server signing key exists           |
| S-2  | The AI has no sign, send, execute, transfer, or arbitrary-calldata tool             | agent tool registry test                            |
| S-3  | Every quote is validated by deterministic code before display and again at approval | quote/policy unit tests                             |
| S-4  | Price freshness uses the original oracle `updatedAt`                                | price ingestion tests with a fake clock             |
| S-5  | A stale price is never refreshed by copying it with a new timestamp                 | provenance test asserts immutable `sourceUpdatedAt` |
| S-6  | No mainnet address appears in Base Sepolia configuration                            | manifest validation test                            |
| S-7  | No secret is exposed through a `NEXT_PUBLIC_` variable                              | bundle scan in CI                                   |
| S-8  | The kill switch blocks quotes and trades                                            | integration test                                    |
| S-9  | The server recomputes price and policy at approval time                             | integration test with a changed price               |
| S-10 | Testnet-only labelling is visible wherever prices, balances, or P&L appear          | UI review and snapshot test                         |

## C. Functional acceptance (later phases)

### C1. Wallet and identity

- A new user can sign in with email and receive a CDP smart account on Base
  Sepolia.
- An existing user can connect MetaMask or Coinbase Wallet through wagmi.
- A wrong network produces a blocking prompt and no transaction can be built.
- Disconnecting clears session state.

### C2. Faucet

- A wallet can claim tUSDC once per 24 hours.
- The claim is capped per address and per IP.
- The claim emits an event that the indexer records.
- Abuse attempts are rejected with a clear error.

### C3. Quotes and trading

- A quote shows price, fee, amount, minimum received, source timestamp, and
  staleness status.
- The same state and inputs always produce the same quote.
- The quote expires; an expired quote cannot be approved.
- The server recomputes the quote at approval and rejects drift.
- The user signs the transaction in their own wallet.
- A successful trade updates balance, portfolio, and P&L after indexing.
- The agent can request a quote but cannot submit it.

### C4. Price service

- The service reads the approved Chainlink feed and stores `roundId`,
  `sourceUpdatedAt`, `observedAt`, and the raw answer.
- Weekend and holiday behaviour is labelled "market closed / stale" rather than
  "fresh".
- A paused or zero feed blocks quotes.
- The ingestion job is idempotent across retries.
- No write to Base Sepolia fabricates a new source timestamp.

### C5. Portfolio and P&L

- Portfolio valuation is computed from indexed balances and validated prices.
- P&L is labelled simulated and reconciles with the fills that produced it.
- Mixed-currency or unpriced holdings are excluded with an explicit warning.
- No floating-point arithmetic is used for money.

### C6. Indexer

- Events are indexed exactly once.
- A reorg rolls back affected rows and replays from the correct checkpoint.
- Indexer lag is observable.

### C7. Admin and operations

- Unauthorised users cannot reach admin routes.
- Roles are enforced server-side.
- The kill switch stops new quotes and trades within one request.
- Every admin action is audited with actor, time, and reason.

### C8. Growth and observability

- Referral codes are unique and idempotent.
- Quests cannot be completed twice.
- Feedback is stored and exportable.
- PostHog events and Sentry errors exclude wallets, emails, and secrets.
- Alerts fire on stale prices, indexer lag, and error spikes.

## D. Explicit non-goals for this phase

- Mainnet trading or mainnet deployment.
- Real-money settlement.
- AMM or DEX routing.
- Token issuance, airdrops, or yield.
- Autonomous agent execution.
- Claims that simulated P&L is real investment performance.
