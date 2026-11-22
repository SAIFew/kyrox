# KYROX — Product acceptance criteria

Version: Phase 1 (2026-11-21)

Each criterion is testable. Phase 0 recorded the scaffold; Phase 1 adds the
core engine and contracts. Criteria are grouped by the milestone that owns them.

## A. Phase 0 gate (this milestone)

| ID    | Criterion                                                                 | Verification                                        |
| ----- | ------------------------------------------------------------------------- | --------------------------------------------------- |
| P0-1  | `kyrox-app` exists as a separate repository and `kyrox-mcp` is unmodified | Git status in both repositories                     |
| P0-2  | pnpm workspace contains `apps/web`, `packages/*`, `services/*`            | `pnpm-workspace.yaml`, directory inspection         |
| P0-3  | TypeScript strict mode is enabled for every package                       | `tsconfig.base.json`, `pnpm typecheck`              |
| P0-4  | Lint, format, type-check, tests, and build pass                           | `pnpm check` locally and CI                         |
| P0-5  | No contract is deployed and no address is recorded                        | `deployments/base-sepolia.json`, deployment history |
| P0-6  | ADRs 0001–0008 are present                                                | `docs/adr/`                                         |
| P0-7  | Threat model and acceptance criteria are present                          | `docs/`                                             |
| P0-8  | `.env.example` contains names and descriptions only                       | manual review, no secret values                     |
| P0-9  | CI runs lint, format, type-check, test, build, and Foundry checks         | `.github/workflows/ci.yml`                          |
| P0-10 | `deployments/base-sepolia.json` contains no addresses                     | JSON review                                         |

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

## E. Core engine and contracts (Phase 1)

| ID    | Criterion                                                                                                           | Verification                                |
| ----- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| CE-1  | All money math is integer-only (`bigint` off-chain, `Math.mulDiv` on-chain); no floating point                      | static review; unit and fuzz tests          |
| CE-2  | Price is USDC per one whole stock token in 6-decimal units, applied identically on both sides                       | golden vectors, quote tests                 |
| CE-3  | Buy and sell outputs floor; the venue never pays more than exact value                                              | rounding tests; fuzz floor property         |
| CE-4  | Conversions honour 6, 8 and 18 decimals; decimals are read from the token, never assumed                            | `Fuzz.t.sol` decimals test; `units.test.ts` |
| CE-5  | Minimum-output calculation floors and is enforced by the contract                                                   | quote tests; `SlippageExceeded` tests       |
| CE-6  | Policy enforces 1 tUSDC minimum, 1,000 tUSDC maximum, 5,000 tUSDC daily cap, allowlist, pause, freshness and expiry | `policy.test.ts` matrix                     |
| CE-7  | Freshness is configured per asset and judged from the original `sourceUpdatedAt`                                    | per-asset bounds test; stale tests          |
| CE-8  | Publication never rewrites the source timestamp; `publishedAt` is separate                                          | provenance tests                            |
| CE-9  | Duplicate, older, zero and future observations are rejected                                                         | replay/timestamp tests                      |
| CE-10 | Only the exchange can mint or burn tokens; there is no unrestricted mint selector                                   | token tests                                 |
| CE-11 | Pause blocks both buy and sell; only the pauser role can pause                                                      | pause tests                                 |
| CE-12 | TypeScript and Solidity agree on every shared golden vector                                                         | `GoldenVectors.t.sol` + `golden.test.ts`    |
| CE-13 | No contract is deployed and no address is recorded in this phase                                                    | `deployments/base-sepolia.json` review      |

## F. Price ingestion and intent preparation (Phase 1)

| ID    | Criterion                                                                                                             | Verification                              |
| ----- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| PI-1  | Only verified Chainlink Base Mainnet proxies are read, pinned to chain 8453                                           | `registry.test.ts`, `feed-reader.test.ts` |
| PI-2  | Code presence, description, decimals, round, answer, and timestamps are validated                                     | `feed-reader.test.ts` negative matrix     |
| PI-3  | `latestAnswer()` is never used; `latestRoundData()` is the only price read                                            | source review; adapter tests              |
| PI-4  | Raw answer and feed decimals are preserved; normalization is integer-only                                             | `normalize.test.ts`                       |
| PI-5  | `sourceUpdatedAt` and `observedAt` are stored separately and never rewritten                                          | `worker.test.ts`, schema test             |
| PI-6  | Duplicate rounds are idempotent via database uniqueness                                                               | migration SQL test, worker restart test   |
| PI-7  | Invalid observations and RPC/store failures are recorded, never overwritten silently                                  | `worker.test.ts`                          |
| PI-8  | Unchanged rounds produce no new observation; no fabricated freshness                                                  | `worker.test.ts`                          |
| PI-9  | Publication prepares unsigned calldata only, preserves provenance, and refuses missing deployment or duplicate rounds | `publication.test.ts`                     |
| PI-10 | Intent preparation recomputes the quote and rejects changed token, decimals, chain, observation, expiry, or policy    | `intent.test.ts`                          |
| PI-11 | No signing, key handling, or broadcast path exists in either service                                                  | source-level assertions in tests          |
| PI-12 | No public API endpoint was added before an authentication model exists                                                | route review                              |

## D. Explicit non-goals for this phase

- Mainnet trading or mainnet deployment.
- Real-money settlement.
- AMM or DEX routing.
- Token issuance, airdrops, or yield.
- Autonomous agent execution.
- Claims that simulated P&L is real investment performance.
