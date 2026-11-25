# KYROX requirements traceability

Source documents reviewed in full (text plus rendered pages, tables and diagrams):

| ID  | Document                                | Date        | Role in this repository                                             |
| --- | --------------------------------------- | ----------- | ------------------------------------------------------------------- |
| TN  | `KYROX Testnet MVP and Growth Plan.pdf` | 21 Nov 2026 | Primary release target. Implementable now on Base Sepolia.          |
| MN  | `KYROX MVP and Growth Plan.pdf`         | 21 Nov 2026 | Future mainnet plan. Gated by legal/eligibility and real liquidity. |
| MK  | `KYROX Marketing Playbook.pdf`          | 21 Nov 2026 | Growth/operations playbook. Mostly non-code.                        |
| CB  | `BOUNTY.md` (Day 13 programme)          | 20 Nov 2026 | Contribution rules and amounts. Canonical copy at repo root.        |

Status legend:

- **IMPLEMENTED** — code exists and is covered by a test or an explicit runtime check in this repository.
- **PARTIAL** — a real mechanism exists, but it differs from the document or lacks one required surface.
- **DEFERRED** — applicable but deliberately not built in this consolidation pass. No claim of completion.
- **BLOCKED** — needs an external decision, credential, deployment, or legal review.
- **OPS** — operational/marketing action, not product code.

> This matrix records evidence, not aspiration. A requirement is only marked IMPLEMENTED where a
> reader can open the referenced file and see the behaviour. The mainnet plan is explicitly not
> claimed as implemented.

---

## 1. Testnet MVP (`TN`) — product and safety

### 1.1 Venue, tokens and contracts

| ID   | Requirement                                                                   | Status      | Evidence / notes                                                                                                                                                            |
| ---- | ----------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TN-1 | Own small market on Base Sepolia; mint/burn at posted price; no pools         | IMPLEMENTED | `packages/contracts/src/KyroxExchange.sol` (`buy`, `sell`, mint/burn via token roles); no AMM/router.                                                                       |
| TN-2 | Test USDC, 6 decimals, exchange-only mint/burn, welcome + daily faucet        | IMPLEMENTED | `packages/contracts/src/TestUSDC.sol`: `DECIMALS = 6`, `WELCOME_AMOUNT = 1,000e6`, `DAILY_AMOUNT = 100e6`, `DAILY_PERIOD = 1 days`.                                         |
| TN-3 | Seven stock tokens: tAAPL, tNVDA, tMSFT, tGOOGL, tAMZN, tTSLA, tMETA; 18 dec. | IMPLEMENTED | `packages/core/src/assets.ts` `TESTNET_ASSETS`; `packages/contracts/src/TestStock.sol`; bootstrap deploys 18-decimal tokens.                                                |
| TN-4 | Plain test names ("Test Apple, tAAPL"); no company logos                      | IMPLEMENTED | `apps/web/lib/presentation.ts` display names; `AssetMark` uses initials/glyphs, not logos.                                                                                  |
| TN-5 | Exchange emits `Trade`; one contract; easy to index                           | IMPLEMENTED | `Trade` event plus `services/indexer` decodes it into `indexed_trades` with checkpoints and reorg rollback.                                                                 |
| TN-6 | Per-asset max price age enforced on-chain (10 minutes for testnet)            | IMPLEMENTED | `KyroxExchange.listAsset(..., maxAgeSeconds, ...)`; `_requireTradeObservation` rejects stale observations. Bootstrap and dry-run now default to `600`.                      |
| TN-7 | Owner is a Safe multisig; `pause` is the on-chain kill switch                 | PARTIAL     | Roles (`DEFAULT_ADMIN`, `PAUSER`, `PRICE_UPDATER`) and `pause`/`unpause` exist and are tested. A real Safe owner is a deployment action, not done here.                     |
| TN-8 | Contracts tested (buy, sell, stale, paused, minOut) and verified on Basescan  | PARTIAL     | 94 Foundry tests cover these paths. Real Sepolia deployment + Basescan verification + Safe ownership remain external.                                                       |
| TN-9 | Updater can only post prices; post all stocks in one call                     | PARTIAL     | `KyroxExchange.setPrice` is `PRICE_UPDATER_ROLE`-gated and provenance-bound. The current publisher prepares one unsigned `setPrice` per asset rather than one batched call. |

### 1.2 Pricing, policy and execution

| ID    | Requirement                                                                                              | Status                  | Evidence / notes                                                                                                                                                                                           |
| ----- | -------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TN-10 | Read Chainlink Base-mainnet reference feeds with a normal RPC call                                       | IMPLEMENTED             | `services/price/src/feeds/registry.ts` (verified AMZN/GOOGL/META/MSFT added), ingestion worker and provenance checks.                                                                                      |
| TN-11 | Price updater posts to Sepolia every few minutes                                                         | PARTIAL                 | `services/price/src/cli` + publication preparation exist; scheduling (Vercel Cron/worker) and live Sepolia posting are deployment work.                                                                    |
| TN-12 | Refuse trades when price is more than 10 minutes old                                                     | IMPLEMENTED             | Contract `maxAgeSeconds`; web `TESTNET_MAX_SOURCE_AGE_SECONDS = 600` in `apps/web/lib/server/freshness.ts`; fail-closed tests.                                                                             |
| TN-13 | Per trade $1–$1,000 tUSDC; per day $5,000; listed stocks only                                            | IMPLEMENTED             | `packages/core/src/policy.ts` `TESTNET_TRADE_POLICY`; `evaluateTradePolicy`; tests.                                                                                                                        |
| TN-14 | Basket of up to 4, approved together                                                                     | PARTIAL                 | `/basket`, `/api/quotes/basket`, `/api/trades/basket`; preview applies legs atomically. Live prepares one unsigned intent per leg, so a smart-account batch is still needed for one signature.             |
| TN-15 | Kill switch in dashboard and on-chain `setPaused`                                                        | PARTIAL                 | On-chain `pause` exists. No admin dashboard control; policy respects an exchange-paused state in live reads.                                                                                               |
| TN-16 | Quote expires after 30 seconds                                                                           | IMPLEMENTED             | `packages/core/src/quote.ts` `DEFAULT_QUOTE_TTL_SECONDS = 30`; demo, live, trade-intent and UI all use it; tests.                                                                                          |
| TN-17 | Prepare endpoint re-checks price/policy and sets `minOut` below the quote                                | PARTIAL                 | `apps/web/app/api/trades/prepare/route.ts`; `QuoteService.prepareIntent` re-checks policy and deadline. It does not perform an on-chain `eth_call` dry-run before returning calldata.                      |
| TN-18 | Quote card shows stock, amount, shares, reference price, price age, limits                               | IMPLEMENTED             | `apps/web/components/trade-panel.tsx`; demo quote payload carries all fields.                                                                                                                              |
| TN-19 | Plain refusal reasons; limits live in code, not chat                                                     | IMPLEMENTED             | `packages/core/src/policy.ts` typed violations; API maps them to plain messages; no chat path can mutate limits.                                                                                           |
| TN-20 | One-tap claim of 1,000 tUSDC, gas-free                                                                   | PARTIAL                 | Contract + live `claimWelcome` UI exist. Gas sponsorship (CDP Paymaster) is not wired, so "gas-free" is not yet true.                                                                                      |
| TN-21 | Daily 100 tUSDC claim                                                                                    | IMPLEMENTED             | `TestUSDC.claimDaily`; `apps/web/lib/faucet.ts`; live daily action in `portfolio-view.tsx` with preflight/receipt handling. Demo stays off-chain.                                                          |
| TN-22 | One-tap sign, sponsored gas                                                                              | BLOCKED                 | Wallet signing exists; CDP Paymaster credentials/proxy do not. Requires CDP project and keys.                                                                                                              |
| TN-23 | Trade lands: Basescan link, new balance                                                                  | IMPLEMENTED             | Wallet flow records submitted hash and links to the environment explorer (`apps/web/lib/wallet.ts`, trade panel/activity).                                                                                 |
| TN-24 | Portfolio: value at reference prices, P&L vs average buy, "simulated"                                    | IMPLEMENTED             | `apps/web/lib/demo/session.ts` weighted-average cost basis; `portfolio-view.tsx` and market detail show simulated avg cost/P&L; live mode shows unavailable rather than faking it.                         |
| TN-25 | Sell flow receives tUSDC                                                                                 | IMPLEMENTED             | Quote/policy/execution supports `side: "sell"`; sell quote card and wallet path.                                                                                                                           |
| TN-26 | Market-hours badge: "US market closed" outside US hours                                                  | IMPLEMENTED             | `apps/web/lib/market-hours.ts` (NYSE hours, holidays, early closes, DST), `market-hours-badge.tsx`, rendered on markets list and detail. Badge is informational; testnet trading stays open.               |
| TN-27 | Weekend Gap Guard kept for mainnet                                                                       | DEFERRED                | Mainnet-only feature; testnet exchange has no pool/reference gap. Documented in the mainnet matrix.                                                                                                        |
| TN-28 | Landing/sign-in/quote disclaimers: "Test tokens. No real value. Not real shares. Not investment advice." | IMPLEMENTED             | Exact wording in `apps/web/app/page.tsx`, account/sign-in, `trade-panel.tsx`, portfolio, legal and market detail; `apps/web/test/disclaimers.test.ts`.                                                     |
| TN-29 | No airdrop/token/cash hints; points have no value                                                        | IMPLEMENTED             | No airdrop language in UI; points/quests are not implemented, so nothing implies value. `BOUNTY.md` states no token/airdrop.                                                                               |
| TN-30 | Privacy: wallet address, email only if email sign-in; short notice                                       | PARTIAL                 | `apps/web/app/privacy/page.tsx` implements the notice and links from sign-in/legal. Email sign-in does not exist yet.                                                                                      |
| TN-31 | Agent tools: `list_stocks`, `get_portfolio`, `quote_trade`, `quote_basket`, `get_quests`                 | PARTIAL                 | Web MCP bridge adds `kyrox_quote_basket`; Python MCP exposes stock/wallet/unsigned-transfer tools. `get_quests` and a live portfolio MCP tool remain absent.                                               |
| TN-32 | No tool executes; user signs in their wallet                                                             | IMPLEMENTED             | MCP bridge tools are read-only; Python server returns unsigned intents and has no sign/broadcast.                                                                                                          |
| TN-33 | Postgres + indexer turning `Trade`/`Claim` into dashboard rows                                           | IMPLEMENTED             | `services/indexer` plus `indexed_trades`/`indexed_claims`/checkpoints; admin reads them. Not yet run against a real deployment.                                                                            |
| TN-34 | Admin dashboard at `/admin`, admins table, SIWE, server-side roles                                       | IMPLEMENTED             | `/admin`, `admin_roles`, SIWE session guard, server-side permission checks and audit log. Demo mode refuses admin rather than faking identity.                                                             |
| TN-35 | Dashboard pages: Overview, Users, User detail, Live feed, Trades, Growth, Quests, Feedback, Settings     | PARTIAL                 | Overview, Live feed, Users, detail/timeline, Trades, Claims, Analytics, Feedback, Settings, Audit. Growth/Quests are summarised in Analytics and the public rewards page, not separate admin pages.        |
| TN-36 | Roles Owner/Admin/Analyst/Support with specific permissions                                              | IMPLEMENTED             | `apps/web/lib/server/admin.ts` role matrix; tests in `admin-permissions.test.ts`.                                                                                                                          |
| TN-37 | CSV export, sybil flags, manual review, verified-user reporting                                          | IMPLEMENTED             | CSV endpoints; heuristic sybil review in Overview; manual status/notes; public ranks exclude flagged wallets.                                                                                              |
| TN-38 | Quests: claim, first trade, ask 3, 3-stock portfolio, 3 days, invite, feedback                           | IMPLEMENTED             | Core quest engine, durable points ledger, demo derivation, `/rewards` UI; assistant answers count toward the question quest.                                                                               |
| TN-39 | Weekly Trading League, 3-trade minimum, recognition prizes                                               | PARTIAL                 | Weekly leaderboard from Monday 00:00 UTC with a three-trade minimum, ranked by realised P&L on closed trades (unrealised positions are not marked to market). Badge/recognition prizes remain operational. |
| TN-40 | Share card with test portfolio + referral link                                                           | IMPLEMENTED             | `/api/share-card` PNG, referral link/copy actions, `?ref=` capture and attribution.                                                                                                                        |
| TN-41 | Early Tester badge (non-transferable) and first mainnet access                                           | BLOCKED                 | Badge contract not implemented; mainnet access depends on the legal gate. `BOUNTY.md` records this as planned/pending.                                                                                     |
| TN-42 | Bug bounty in real USDC for confirmed bugs                                                               | IMPLEMENTED (programme) | Root `BOUNTY.md` preserves the $10–$50 USDC range and conditions. Actual payouts remain unconfirmed/pending owner+legal review.                                                                            |
| TN-43 | Analytics PostHog, errors Sentry                                                                         | PARTIAL                 | Internal allowlisted `user_events` + `app_events` and admin views work. External PostHog/Sentry SDKs are blocked on approved keys/DSNs.                                                                    |
| TN-44 | Gas-free user operations via a Paymaster proxy; URL hidden                                               | BLOCKED                 | No CDP Paymaster client/proxy. Requires CDP credentials and an allowlist policy.                                                                                                                           |
| TN-45 | Email sign-in creating a smart wallet                                                                    | BLOCKED                 | Injected wallet connect only. CDP embedded wallets/email are not integrated.                                                                                                                               |
| TN-46 | Positive-path E2E on Sepolia (claim → quote → sign → land)                                               | BLOCKED                 | Local Anvil/unit/E2E harness exists; real Sepolia deployment and wallet run require funded testnet keys and a deployed manifest.                                                                           |

### 1.3 Application architecture

| ID    | Requirement                                                      | Status      | Evidence / notes                                                                                                                 |
| ----- | ---------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| TN-47 | Next.js App Router + TypeScript, mobile-first                    | IMPLEMENTED | `apps/web` (Next.js 16 App Router); responsive layout and mobile navigation.                                                     |
| TN-48 | Wallet connection + signing (wagmi-compatible injected provider) | IMPLEMENTED | `apps/web/lib/wallet.ts`, `account-provider.tsx`; SIWE session auth.                                                             |
| TN-49 | CDP embedded wallet / email sign-in                              | BLOCKED     | Not integrated; requires CDP credentials.                                                                                        |
| TN-50 | Agent API with tool calling; no execute tool                     | PARTIAL     | `services/agent/src/index.ts` freezes a read-and-quote-only tool policy and forbidden tool names. No LLM/chat endpoint is wired. |
| TN-51 | Policy engine pure functions with unit tests                     | IMPLEMENTED | `packages/core/src/policy.ts`; unit tests across core, web, trade-intent.                                                        |
| TN-52 | Policy config editable from the dashboard                        | IMPLEMENTED | `policy_config`, validated tighten-only resolver, `/admin` Settings form, HTTP 423 kill switch.                                  |
| TN-53 | Price updater key can only post prices                           | IMPLEMENTED | `PRICE_UPDATER_ROLE` + provenance-bound `setPrice`; Foundry tests.                                                               |
| TN-54 | Postgres + Drizzle                                               | IMPLEMENTED | `packages/db` schema/migrations for price publication, auth, quotes, intents and app events.                                     |
| TN-55 | Indexer for `Trade`/`Claim` events                               | IMPLEMENTED | `services/indexer` with chunking, idempotent upserts, checkpoints, reorg rollback and tests.                                     |
| TN-56 | Structured events for the dashboard                              | IMPLEMENTED | `user_events` allowlist plus `/api/events`, quote/approval/trade/claim instrumentation and admin Analytics/Live feed.            |
| TN-57 | Admin protected route                                            | IMPLEMENTED | `/admin` checks the signed session and database role on every request.                                                           |

---

## 2. Mainnet plan (`MN`) — future, gated

Everything in this section is **DEFERRED** or **BLOCKED**. The testnet exchange remains the
settlement layer in this repository. No mainnet contract, DEX router, eligibility gate, or
Paymaster is claimed.

| ID    | Requirement                                                                              | Status                | Reason / dependency                                                                                                                                               |
| ----- | ---------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MN-1  | Email smart wallet + external wallet sign-in                                             | BLOCKED               | CDP embedded wallets/email credentials.                                                                                                                           |
| MN-2  | Country + non-US attestation + terms version; US/blocked-country screen                  | BLOCKED               | Pure `evaluateEligibility` mechanics exist and are tested, but the legal country list, terms text and screen remain blocked on counsel.                           |
| MN-3  | USDC funding guide/onramp and QR address                                                 | BLOCKED               | Mainnet eligibility and onramp availability.                                                                                                                      |
| MN-4  | Quote card with pool vs Chainlink reference, fees, 1% slippage, sponsored gas            | DEFERRED              | Needs DEX routing and Paymaster.                                                                                                                                  |
| MN-5  | Policy: $1–$100/trade, $250/day, 1% slippage, Gap Guard 2%/5%                            | DEFERRED              | Testnet policy intentionally uses $1–$1,000/$5,000. Mainnet limits must be introduced with the gate.                                                              |
| MN-6  | DEX aggregator routing of Coinbase tokenized stocks                                      | BLOCKED               | Venue selection, API keys, real liquidity.                                                                                                                        |
| MN-7  | Paymaster proxy, allowlist, per-user/global caps                                         | BLOCKED               | CDP project and caps.                                                                                                                                             |
| MN-8  | Weekend Gap Guard (warn >2%, block >5%)                                                  | PARTIAL               | `assessGap` in `@kyrox/core` implements the basis-point warn/block logic with tests. It is not wired to a live DEX because routing/liquidity is blocked.          |
| MN-9  | Share card + referral loop + Early Trader badge                                          | PARTIAL               | Share card, referral capture and attribution are implemented. Early Trader badge remains BLOCKED pending a contract/deployment decision.                          |
| MN-10 | Admin dashboard, roles, kill switch, referral flags                                      | PARTIAL               | Admin/roles/audit/policy kill switch/sybil review are implemented for testnet. Mainnet eligibility and approved flag rules still depend on legal.                 |
| MN-11 | Legal gate: lawyer view on eligibility, India and target countries                       | BLOCKED               | External counsel; explicit precondition in the plan.                                                                                                              |
| MN-12 | Kyro MCP server stays the developer product and points at KYROX API                      | PARTIAL               | Python MCP package is preserved and tested; it is not yet pointed at the web quote API.                                                                           |
| MN-13 | Postgres data model for users/quotes/trades/points/policy config                         | PARTIAL               | Users, referrals, points, indexed trades/claims, policy, feedback, roles and audit exist. Eligibility country/terms records remain blocked with the mainnet gate. |
| MN-14 | Security checklist: server-side keys, rate limits, untrusted tool text, pinned addresses | IMPLEMENTED (preview) | Keys server-side, rate limits, typed request parsing, verified feed registry, correlated errors. Mainnet external review still required.                          |
| MN-15 | Gas sponsorship, creator programme, waitlist, 10-day build                               | OPS/BLOCKED           | Commercial/operational work; gas sponsorship still requires CDP credentials and approvals.                                                                        |

---

## 3. Marketing Playbook (`MK`)

The playbook is an execution guide, not a product specification. Its product-adjacent rules are
reflected in code where possible; the rest is an operations checklist.

| ID   | Requirement                                                             | Status      | Evidence / notes                                                                             |
| ---- | ----------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| MK-1 | One-line pitch: "Trade stocks onchain by talking to an AI…"             | PARTIAL     | The call to action exists, but the app is a deterministic quote UI, not an LLM chat agent.   |
| MK-2 | Every trading post says "testnet, no real value"                        | OPS         | Enforced by the copy reviewer; the product itself shows the disclaimer on trading surfaces.  |
| MK-3 | No fake followers, engagement pods, airdrop hints; permission to repost | OPS         | No code control. `BOUNTY.md` and the legal page state no token/airdrop.                      |
| MK-4 | Share cards with referral links after every trade                       | IMPLEMENTED | `/api/share-card` and referral actions; a per-trade automatic card is not forced by the UI.  |
| MK-5 | Weekly Trading League and Sunday winners                                | PARTIAL     | Weekly realised-P&L leaderboard exists; Sunday recognition posts and prizes are operational. |
| MK-6 | Build in public with real dashboard numbers                             | PARTIAL     | Dashboard metrics now exist; publishing real numbers remains an operations task.             |
| MK-7 | Partner/creator outreach templates and daily reply routine              | OPS         | Playbook content; not repository behaviour.                                                  |
| MK-8 | Never publish a made-up statistic                                       | OPS         | Reinforced by the "verified users" rule in the testnet plan.                                 |
| MK-9 | 21-day content calendar and launch thread                               | OPS         | External scheduling.                                                                         |

---

## 4. Bounty programme (`CB`)

| ID   | Requirement                                                          | Status      | Evidence / notes                                                                        |
| ---- | -------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| CB-1 | Bug bounty **$10–$50 USDC**, severity-dependent                      | IMPLEMENTED | Root `BOUNTY.md` §3.1; unchanged amounts.                                               |
| CB-2 | First six integrations **$25 each / $150 max**                       | IMPLEMENTED | Root `BOUNTY.md` §3.2.                                                                  |
| CB-3 | Feature Idea That Ships **$50**, from Day 14                         | IMPLEMENTED | Root `BOUNTY.md` §3.3.                                                                  |
| CB-4 | Community Challenge **$150** split top 3, Chapter 2 Week 2           | IMPLEMENTED | Root `BOUNTY.md` §3.4.                                                                  |
| CB-5 | $400 suggested pool unconfirmed; payout network/treasury unconfirmed | IMPLEMENTED | Root `BOUNTY.md` §4.                                                                    |
| CB-6 | Legal/tax review before payout; no unlimited obligation              | IMPLEMENTED | Root `BOUNTY.md` §4.                                                                    |
| CB-7 | Early Builder badge planned/pending, non-transferable, no airdrop    | IMPLEMENTED | Root `BOUNTY.md` §7.                                                                    |
| CB-8 | Canonical root copy; package copy preserved for provenance           | IMPLEMENTED | Root `BOUNTY.md` notice; `services/mcp-server/BOUNTY.md` unchanged.                     |
| CB-9 | Working issue template and private security disclosure               | IMPLEMENTED | `.github/ISSUE_TEMPLATE/bug_report.yml`; `SECURITY.md`; root README section links both. |

---

## 5. Deliberate non-goals in this pass

These are not "forgotten". They are separated because implementing them without the required
external dependency would produce a misleading product:

1. **Real mainnet trading** — legal eligibility, DEX venue selection, and real funds are not
   approved. Shipping a mainnet route would violate the plan's own legal gate.
2. **CDP Paymaster / email smart wallets** — require a CDP project, keys, and an allowlist that
   cannot be invented in-repo.
3. **Growth/admin/indexer layer** — the durable layer now exists: `/admin`, roles, audit log,
   policy management, sybil review, Trade/Claim indexer, quests, points, referrals, weekly league,
   share card and basket quotes. Remaining gaps are narrower: live-mode basket execution needs a
   smart-account batch for one signature, the weekly league ranks activity points rather than
   simulated returns, and external PostHog/Sentry SDKs await approved projects.
4. **Unaudited contract claims** — Foundry tests are evidence of behaviour, not an audit.

---

## 6. Verification snapshot

Recorded from the current implementation pass (no commit, push, deploy, or transaction):

| Check                         | Result                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| TypeScript/Vitest             | 63 files passed, 5 skipped; 493 tests passed, 23 skipped                                            |
| Typecheck                     | `core`, `price`, `trade-intent`, `web`, `db`, `protocol` pass                                       |
| ESLint                        | pass                                                                                                |
| Prettier                      | pass                                                                                                |
| Web production build          | pass (admin, rewards, basket, assistant, share-card, health)                                        |
| Foundry                       | 95 tests pass                                                                                       |
| Python MCP                    | 407 tests pass                                                                                      |
| PostgreSQL integration        | 11 tests pass (run against temporary PostgreSQL 16)                                                 |
| Local runtime smoke           | demo auth, assistant, basket quote + atomic fill, feedback, share PNG (200, image/png), admin guard |
| Root documentation link check | pass                                                                                                |
| Issue template YAML           | valid                                                                                               |

The live Base Sepolia deployment, Safe ownership transfer, Basescan verification, Paymaster
sponsorship, and a real end-to-end mainnet/testnet trade are **not** part of this snapshot.
