# KYROX Public Preview — Deployment Notes

## Public preview deployment (simulated venue)

| Item               | Value                                        |
| ------------------ | -------------------------------------------- |
| Public preview URL | <https://kyrox-dun.vercel.app>               |
| Vercel project     | `kyrox` (`prj_HYMi5n2wWhPu7RZJYCSsJfOz4El5`) |
| Root directory     | `apps/web`                                   |
| Framework          | Next.js 16 (App Router)                      |
| Install command    | `cd ../.. && pnpm install --frozen-lockfile` |
| Build command      | `pnpm build`                                 |
| Runtime mode       | `KYROX_DEMO_MODE=1` (simulated venue)        |
| Liveness           | <https://kyrox-dun.vercel.app/api/healthz>   |
| Readiness          | <https://kyrox-dun.vercel.app/api/readyz>    |
| Health detail      | <https://kyrox-dun.vercel.app/api/health>    |
| MCP bridge         | <https://kyrox-dun.vercel.app/api/mcp>       |

Environment variables set for Production, Preview, and Development:

- `AUTH_SECRET` — 32+ character HMAC secret for preview sessions and quote tokens.
- `KYROX_DEMO_MODE` — `1`, enabling deterministic simulated markets and signed preview accounts.
- `APP_ORIGIN` — canonical HTTPS origin (`https://kyrox-dun.vercel.app`) used for SIWE host/URI binding and exact mutation `Origin` checks. Missing `Origin` is rejected for non-loopback origins. A configured HTTPS origin is validated under production HTTPS rules even when `KYROX_ENVIRONMENT` remains unset; plain HTTP is still limited to loopback development.
- `NEXT_PUBLIC_APP_URL` — canonical origin used by metadata, sitemap, and documentation snippets; also a migration fallback for `APP_ORIGIN`.
- `NEXT_PUBLIC_CHAIN_ENV` — `base-sepolia`.
- `NEXT_PUBLIC_CHAIN_ID` — `84532`.

No database, indexer, RPC endpoint, or deployed contract is required for this preview.
The web application is live, but market data, balances, fills, and activity are simulated.
Do not describe this deployment as live trading or live Chainlink prices.
`/api/readyz` therefore checks only that the signed-session secret is valid in preview
mode; it never attempts a database or RPC connection and never returns secret values.

## Redeploying

From the repository root (Vercel CLI is linked to `apps/web` via the project's root directory):

```bash
npx vercel deploy --prod --yes
```

The CLI uploads the monorepo and Vercel builds from `apps/web` with the root lockfile. The latest
commit author must be a member of the Vercel account for Git-attributed deployments.

## What is genuinely live in the preview

- Next.js application, all product routes, API routes, and the read-only MCP bridge.
- Deterministic quote engine (`@kyrox/core`), testnet trade policy, and freshness semantics.
- Signed, HttpOnly preview accounts with simulated balances and a local fill ledger.
- Wallet signature verification (SIWE-style) when a browser wallet is available.

“Live” here means the web service is deployed and reachable. It does not mean a
live exchange, live oracle, or broadcast transaction path.

## Explicit preview fallback

The fallback is intentional and must remain explicit in operations:

- `KYROX_DEMO_MODE=1` forces the simulated preview.
- Blank/unset `KYROX_DEMO_MODE` plus an empty `DATABASE_URL` selects preview so a
  fresh deployment remains usable.
- `KYROX_DEMO_MODE=0` disables the fallback. It requires `DATABASE_URL`, a strong
  `AUTH_SECRET`, `KYROX_ENVIRONMENT=base-sepolia`, `BASE_SEPOLIA_RPC_URL`, and an
  approved `deployments/base-sepolia.json` with `status: deployed`.
- Never flip the public preview to `0` as a test. Use an isolated live-mode build
  and a temporary manifest, as the release-readiness CI job does.

For Base Sepolia, `KYROX_MARKET_SESSION_MODE=unknown` is the fail-closed default.
`always-open-testnet` is an explicit testnet-only opt-in that still relies on
source-timestamp freshness; it is not a mainnet or 24/7-live-price claim.
`PRICE_PUBLICATION_ENABLED=false` is enforced until publication is approved.

## Deployment payload policy

`.vercelignore` excludes standalone `video/`, `content/`, and generated
audio/video formats from Vercel uploads. Deployment manifests under
`deployments/` are retained, and Next.js file tracing explicitly includes
`base-sepolia.json` plus `local-anvil.json` whenever that generated local file
exists.

## What is not deployed in the preview

- `KyroxExchange`, `TestUSDC`, and stock tokens are **not** on Base Sepolia; `deployments/base-sepolia.json` remains unpopulated.
- No Chainlink publication worker runs against this host.
- No durable event indexer runs; activity in preview mode is session-scoped.
- No mainnet trading, custody, deposits, or withdrawals.

## Custom domain

`kyrox.io` and `www.kyrox.io` are attached to the Vercel project and ownership is verified, but the
domain is **misconfigured at the DNS provider**. DNS was re-verified on 2026-11-24: it delegates to
`ns1.dns-expired.com` / `ns2.dns-expired.com`, with an apex `A` record of `2.57.91.92`. That is not Vercel, so the domain does not serve the app yet.

Required action (the owner must do this in Hostinger or wherever DNS is managed):

1. Restore/repair DNS for `kyrox.io` (the current delegation is an expired-DNS service).
2. Either delegate to the Vercel nameservers (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`), or create:
   - `A @ → 216.198.79.1`
   - `A @ → 64.29.17.1`
   - `CNAME www → 734ed17315427d40.vercel-dns-017.com.`
3. Once DNS resolves, set `NEXT_PUBLIC_APP_URL=https://kyrox.io` in Vercel and redeploy.

Recorded Vercel diagnostic: `misconfigured: true`; DNS state above was re-verified on 2026-11-24.
Re-verify the Vercel diagnostic again before release. No domain purchase is required if this domain
belongs to you.

`kyrox.app` and `kyrox.finance` had no RDAP record at the time of deployment and appear to be
available for registration if `kyrox.io` is not yours.
