# KYROX — Initial threat model

Version: Phase 0 (2026-11-21)

Scope: the Base Sepolia consumer MVP and its read-only Base Mainnet price
ingestion. Mainnet trading, real-money settlement, and token issuance are out
of scope.

## 1. Assets

| Asset                                   | Why it matters                                        |
| --------------------------------------- | ----------------------------------------------------- |
| User smart-account authority            | Whoever can sign for the wallet controls its assets   |
| tUSDC and test stock token balances     | Testnet value, but they model real flows              |
| Quote and policy integrity              | A wrong quote can authorise a bad trade               |
| Oracle provenance                       | A fabricated timestamp makes a stale price look fresh |
| Admin and kill-switch authority         | Compromising it can halt or manipulate the product    |
| Database and audit records              | Needed for reconciliation and incident response       |
| Secrets (CDP, DB, RPC, session, Sentry) | Direct path to impersonation or data loss             |
| User PII and wallet addresses           | Privacy and regulatory exposure                       |

## 2. Actors

- Consumer user (legitimate).
- Existing-wallet user (MetaMask, Coinbase Wallet).
- AI assistant (untrusted reasoning, may be prompt-injected).
- Admin operator.
- External attacker.
- Malicious or compromised RPC provider.
- Compromised dependency in the supply chain.

## 3. Trust boundaries

1. Browser ↔ Next.js server.
2. Next.js server ↔ Postgres.
3. Next.js server ↔ Base Sepolia RPC.
4. Price service ↔ Base Mainnet RPC.
5. Agent service ↔ model provider.
6. Agent service ↔ application API.
7. Admin ↔ admin routes.
8. CI/CD ↔ deployment environment.

## 4. Threats and mitigations

| ID   | Threat                          | Vector                                     | Impact                       | Mitigation                                               | Status   |
| ---- | ------------------------------- | ------------------------------------------ | ---------------------------- | -------------------------------------------------------- | -------- |
| T-01 | Prompt injection causes a trade | Malicious text asks the agent to execute   | Unauthorised trade           | Agent has no execution tool; user signs; server rechecks | Designed |
| T-02 | Stale price accepted as fresh   | Weekend feed holds last value              | MisPriced trade              | Use `sourceUpdatedAt`; staleness bound; block or label   | Designed |
| T-03 | Timestamp laundering            | Publisher copies old price with new time   | Fake freshness               | Persist original round id and timestamp; immutable       | Designed |
| T-04 | Quote tampering                 | Client modifies price or amount            | User signs a bad trade       | Server recomputes at approval; bind quote hash           | Planned  |
| T-05 | Replay                          | Reuse a signed intent                      | Duplicate trade              | Nonce, expiry, intent hash, chain id                     | Planned  |
| T-06 | Mainnet address in Sepolia      | Copy-paste or bad config                   | Funds sent to wrong contract | Per-chain manifest; validation test; no shared config    | Designed |
| T-07 | RPC manipulation                | Provider lies about balances or simulation | Bad quote or false success   | Chain-id check, bytecode check, provider diversity later | Partial  |
| T-08 | Key exfiltration                | Secret in client bundle or repo            | Full compromise              | Server-only secrets; bundle scan; no keys in env example | Designed |
| T-09 | Admin compromise                | Weak auth on admin routes                  | Kill switch or role abuse    | Separate admin auth, MFA, RBAC, audit                    | Planned  |
| T-10 | Kill switch bypass              | Cached quotes continue after pause         | Losses during incident       | Recheck flag on every write path; fail closed            | Planned  |
| T-11 | Indexer reorg corruption        | Chain reorg after indexing                 | Wrong balances/P&L           | Checkpoints, rollback, idempotent handlers               | Planned  |
| T-12 | Faucet abuse                    | Scripted claims                            | Test funds drained           | Per-address/IP limits, caps, monitoring                  | Planned  |
| T-13 | Referral fraud                  | Self-referral, sybil                       | Inflated rewards             | Identity binding, idempotency, anomaly review            | Planned  |
| T-14 | PII leakage                     | Analytics, logs, Sentry events             | Privacy harm                 | Scrub wallets/emails; retention policy                   | Planned  |
| T-15 | Supply-chain compromise         | Malicious npm or Foundry dependency        | Code execution               | Lockfile, pinned versions, review, CI                    | Partial  |

## 5. Controls in place

- Separate repository and workspace boundaries.
- Strict TypeScript and CI gates.
- Frozen agent tool policy (`services/agent`), enforced by a test.
- Unpopulated Sepolia manifest; no mainnet addresses.
- Environment template with names only; no credentials.
- ADRs recording the no-execution, freshness, and isolation rules.
- Integer-only quote math on both sides, with floor rounding and shared golden
  vectors (T-02, T-03).
- Original `sourceUpdatedAt` and `roundId` stored on-chain; a separate
  `publishedAt` prevents timestamp laundering.
- Round monotonicity and non-decreasing source timestamps block replay.
- Per-asset freshness bounds; a 24/5 feed that stops advancing becomes stale.
- `EXCHANGE_ROLE`-gated token mint/burn with no unrestricted mint path.
- `whenNotPaused` plus `nonReentrant` on both trade directions; pauser role
  separated from admin.
- Feed-independent price interface so one global feed assumption is impossible.
- Mandatory price bands and an optional deviation guard on publication.
- Stale publications rejected; frozen assets recoverable only while paused.
- Trade deadlines and delivered-amount verification on both entry points.
- Tokens can only burn their own balance (`from == msg.sender`).
- Chainlink reads are pinned to Base Mainnet and validated for code, description,
  decimals, round completeness, and timestamps.
- Observations persist the original source timestamp separately from retrieval.
- Publication and intent preparation are unsigned-only; no key material exists in
  either service.

## 6. Residual risks

- The real B20 tokens and Coinbase Chainlink feeds exist only on Base Mainnet.
  Sepolia prices are therefore a published reference, not a native testnet
  oracle. This must be labelled everywhere.
- The 24/7 smoothed feeds are not yet verified for the chosen assets, chain, or
  feed type. Do not assume availability.
- Contract code and the exchange are not implemented or audited.
- No production key-management or incident-response process exists yet.

## 7. Out of scope

- Mainnet deployment and real funds.
- Smart-contract economic exploits beyond the fixed-price model.
- Model-provider compromise.
- Regulatory classification of tokenized equities.
