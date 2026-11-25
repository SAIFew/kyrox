# Platform operations: admin, indexer, growth, and policy

This document covers the durable testnet platform layer added after the initial
consolidation. It is operational documentation, not a claim of mainnet readiness.
Nothing here signs, broadcasts, or holds user funds.

## 1. Database model

Migration: `packages/db/drizzle/0006_good_squadron_supreme.sql`.

| Table                 | Purpose                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `app_users`           | One signed-in wallet, optional email, referral code/attribution, status, hashed signup IP. |
| `user_events`         | Allowlisted product/analytics events. Never full chat text.                                |
| `points_entries`      | Append-only quest points with an idempotent `(user, quest, source)` key.                   |
| `referrals`           | Referrer/referee relationship, qualified only after the referee's first indexed trade.     |
| `indexed_trades`      | One exchange `Trade` log, unique by chain/tx/log index.                                    |
| `indexed_claims`      | Welcome/daily faucet claims.                                                               |
| `indexer_checkpoints` | Last fully processed block/hash per stream.                                                |
| `admin_roles`         | Owner/admin/analyst/support wallet roles.                                                  |
| `admin_audit_log`     | Append-only privileged action history.                                                     |
| `policy_config`       | Validated dashboard-editable policy values.                                                |
| `feedback_entries`    | User feedback, separate from chat.                                                         |

Run migrations with `pnpm migrate` (uses `DIRECT_DATABASE_URL` or `DATABASE_URL`).

## 2. Admin dashboard

Route: **`/admin`**. Access requires:

1. a live deployment with PostgreSQL;
2. a signed wallet session;
3. the wallet in `admin_roles`.

Preview/demo mode intentionally has no admin identity. It does not fake a local owner.

### Bootstrap the first owner

```bash
DATABASE_URL=postgres://... ADMIN_WALLET=0x... ADMIN_ROLE=owner pnpm admin:grant
```

The script writes the role and an `admin_bootstrap` audit entry. The owner then manages
other roles under **Settings → Admin roles**.

### Role matrix

| Action                                         | Owner | Admin | Analyst   | Support |
| ---------------------------------------------- | ----- | ----- | --------- | ------- |
| Overview, live feed, trades, claims, analytics | Yes   | Yes   | Yes       | Yes     |
| User list and timeline                         | Yes   | Yes   | Yes       | Yes     |
| View emails                                    | Yes   | Yes   | Masked    | Yes     |
| Export CSV                                     | Yes   | Yes   | No emails | No      |
| Flag/unflag, notes                             | Yes   | Yes   | No        | Yes     |
| Remove from leaderboard (flag)                 | Yes   | Yes   | No        | No      |
| Change policy/kill switch                      | Yes   | Yes   | No        | No      |
| Add/remove admins                              | Yes   | No    | No        | No      |
| Delete personal data                           | Yes   | No    | No        | No      |
| Read audit log                                 | Yes   | Yes   | No        | No      |

Every privileged mutation is written to `admin_audit_log` with before/after JSON.
Authorization is checked server-side for every page and API call, not only in the UI.

### Admin pages

Overview (funnel, volume, claims, refusals, top stocks, sybil suggestions), Live feed,
Users, User detail/timeline, Trades, Claims, Analytics (events + warnings/errors),
Feedback, Settings (policy, kill switch, roles, exports), Audit log.

Sybil suggestions are heuristics only: shared signup IP fingerprint, claimed-but-never-traded,
identical trade sizes within ten minutes across wallets, and near-minimum one-trade referral
chains. A human decides whether to flag; flagged wallets keep access but leave public ranks.

### Data deletion

An owner can delete a wallet's personal data from the user detail page. This removes the
account, events, points, referrals, feedback, indexed trades, and claims. The audit log keeps
the action without retaining the wallet as its target.

## 3. Indexer

Package: `services/indexer`. CLI: `pnpm indexer:run`.

It reads `KyroxExchange` `Trade` logs and `TestUSDC` `WelcomeClaimed`/`DailyClaimed` logs from
the verified Base Sepolia manifest. It fails closed when the manifest is unpopulated, missing
contracts, or contains an unlisted stock token.

Environment:

```bash
BASE_SEPOLIA_RPC_URL=...
DATABASE_URL=...
KYROX_DEPLOYMENT_MANIFEST=deployments/base-sepolia.json
INDEXER_START_BLOCK=...      # only when no checkpoint exists
INDEXER_CONFIRMATIONS=12
INDEXER_CHUNK_SIZE=2000
INDEXER_REORG_DEPTH=12
INDEXER_INTERVAL_MS=15000
INDEXER_ONCE=0               # 1 for one cycle / cron
```

Behaviour:

- Processes only `latest - confirmations` blocks.
- Writes a checkpoint per chunk.
- Compares the checkpoint hash to the canonical block; on mismatch, deletes the last
  `INDEXER_REORG_DEPTH` blocks and re-indexes them.
- Upserts are idempotent by chain/tx/log index.
- Each trade/claim emits `trade_landed`/`faucet_claimed` analytics and runs quest awards.
- The indexer never signs or broadcasts.

## 4. Growth: quests, points, referrals, league

Public page: **`/rewards`**.

Documented quests and points:

| Quest                      |           Points | Rule                                                |
| -------------------------- | ---------------: | --------------------------------------------------- |
| Claim test USDC            |               10 | Indexed welcome/daily claim.                        |
| First trade                |               50 | One indexed trade.                                  |
| Ask 3 questions            |               20 | Three recorded assistant questions.                 |
| Portfolio of 3+ stocks     |               30 | Three positive net positions from indexed trades.   |
| Trade on 3 days            |              100 | Three distinct UTC trade days.                      |
| Invite a friend who trades | 100 each, max 10 | Referral qualified after the referee's first trade. |
| Feedback                   |               30 | One feedback submission.                            |

Points have **no cash value and no token value**. There is no airdrop. The page states this
explicitly and the same disclosure is returned by `/api/rewards`.

Referral capture: any link with `?ref=KX######` sets an HTTP-only first-party cookie; the
referral is attributed once on wallet sign-in and never overwritten. Self-referrals are
ignored. Referral credit requires a real indexed trade, not only a signup.

League: `/rewards` shows the current week's leaderboard (Monday 00:00 UTC), requiring at least
three indexed trades in that week. It ranks **realised P&L** from closed indexed trades; unrealised
positions are not marked to market because the indexer does not hold a reconciled current price per
wallet. The UI states this. All-time points are shown separately.

Demo mode derives quest progress from the signed local ledger, including assistant questions and
feedback. It shows an empty live leaderboard rather than fabricating other users.

## 5. Assistant

Route: **`/assistant`**, API `POST /api/assistant`.

Deterministic grammar, not an LLM. It understands a narrow set of sentences:

- `Buy $100 of Nvidia` / `sell 12.5 of Tesla`
- `What is Tesla at?`
- `How is my portfolio?`
- `Build me a tech portfolio with $500`

It returns an explanation and a link to the relevant market or basket page. It cannot sign,
execute, change policy, or build arbitrary calldata. Only the question count and a topic category
are stored, never full text.

## 6. Basket quotes

Route: **`/basket`**, APIs `POST /api/quotes/basket` and `POST /api/trades/basket`.

- 1–4 distinct allowlisted legs.
- Each leg is checked against per-trade limits; the sum is checked against the daily limit.
- Quotes expire in 30 seconds.
- Preview mode applies all legs atomically to the local ledger.
- Live mode prepares one unsigned intent per leg. Without a smart-account batch, the wallet may
  ask for each signature separately. The endpoint never signs or broadcasts.

## 7. Policy management and kill switch

`/admin?tab=settings` reads and writes `policy_config`. Validation is performed by
`resolveEditablePolicy` in `@kyrox/core`:

- minimum cannot go below the launch minimum (`1 tUSDC`);
- maximum cannot exceed `1,000 tUSDC`;
- daily cannot exceed `5,000 tUSDC`;
- the allowlist must be a non-empty subset of the seven listed assets;
- the daily limit must be at least the maximum trade.

The kill switch (`tradingEnabled=false`) makes live quote and prepare routes return HTTP 423
`trading_paused`. It is separate from the on-chain `pause()` role, which remains the contract-level
control and is not signed by the server.

## 8. Analytics and error monitoring

- Client/server events are written to `user_events` through `POST /api/events` (allowlisted
  names, flat bounded props, no full chat text).
- API warnings/errors are written to `app_events`; `/admin?tab=analytics` shows the last week.
- `POST /api/events` is a no-op acknowledgement in preview mode.
- External PostHog and Sentry SDK wiring is **BLOCKED** until keys/DSNs are approved. The
  internal event/error store works without them and does not pretend to be Sentry.

## 9. Share cards

- `GET /api/share-card` returns an authenticated PNG card with the preview/live portfolio value,
  top positions, referral link, and the exact testnet disclaimer.
- The portfolio page has **Share card** and **Referral link** actions.
- The card is generated only for the signed-in session; it is not a public profile endpoint.
- No company logos, no real-share claims.

## 10. Still blocked

These remain blocked exactly as recorded in `docs/REQUIREMENTS_TRACEABILITY.md`:

- CDP Paymaster and gas sponsorship (requires CDP project/credentials/allowlist).
- CDP embedded wallets / email sign-in.
- Real Base Sepolia deployment, Safe ownership, Basescan verification.
- Mainnet legal eligibility gate, DEX routing, real liquidity.
- External PostHog/Sentry projects.
- WalletConnect relay/project ID (injected EVM wallets work today; the environment
  advertises WalletConnect availability only when a project ID is configured).
- Early Builder badge contract and any reward funding/legal decision.

Do not replace these with fake clients, invented credentials, or simulated approvals.
