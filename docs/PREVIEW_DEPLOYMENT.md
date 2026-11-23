# KYROX Public Preview — Deployment Notes

## Live deployment

| Item            | Value                                        |
| --------------- | -------------------------------------------- |
| Production URL  | <https://kyrox-dun.vercel.app>               |
| Vercel project  | `kyrox` (`prj_HYMi5n2wWhPu7RZJYCSsJfOz4El5`) |
| Root directory  | `apps/web`                                   |
| Framework       | Next.js 16 (App Router)                      |
| Install command | `cd ../.. && pnpm install --frozen-lockfile` |
| Build command   | `pnpm build`                                 |
| Runtime mode    | `KYROX_DEMO_MODE=1` (simulated venue)        |
| Health check    | <https://kyrox-dun.vercel.app/api/health>    |
| MCP bridge      | <https://kyrox-dun.vercel.app/api/mcp>       |

Environment variables set for Production, Preview, and Development:

- `AUTH_SECRET` — 32+ byte HMAC secret for preview sessions and quote tokens.
- `KYROX_DEMO_MODE` — `1`, enabling deterministic simulated markets and signed preview accounts.
- `NEXT_PUBLIC_APP_URL` — canonical origin used by metadata, sitemap, and documentation snippets.
- `NEXT_PUBLIC_CHAIN_ENV` — `base-sepolia`.
- `NEXT_PUBLIC_CHAIN_ID` — `84532`.

No database, indexer, RPC endpoint, or deployed contract is required for this preview.

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

## What is not deployed

- `KyroxExchange`, `TestUSDC`, and stock tokens are **not** on Base Sepolia; `deployments/base-sepolia.json` remains unpopulated.
- No Chainlink publication worker runs against this host.
- No durable event indexer runs; activity in preview mode is session-scoped.
- No mainnet trading, custody, deposits, or withdrawals.

## Custom domain

`kyrox.io` and `www.kyrox.io` are attached to the Vercel project and ownership is verified, but the
domain is **misconfigured at the DNS provider**. It is registered at Hostinger (expiry 2027-10-27)
and currently delegates to `ns1.dns-expired.com` / `ns2.dns-expired.com`, with an apex `A` record of
`2.57.91.92`. That is not Vercel, so the domain does not serve the app yet.

Required action (the owner must do this in Hostinger or wherever DNS is managed):

1. Restore/repair DNS for `kyrox.io` (the current delegation is an expired-DNS service).
2. Either delegate to the Vercel nameservers (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`), or create:
   - `A @ → 216.198.79.1`
   - `A @ → 64.29.17.1`
   - `CNAME www → 734ed17315427d40.vercel-dns-017.com.`
3. Once DNS resolves, set `NEXT_PUBLIC_APP_URL=https://kyrox.io` in Vercel and redeploy.

Vercel's current diagnostic: `misconfigured: true`; recommended records as above. No domain purchase
is required if this domain belongs to you.

`kyrox.app` and `kyrox.finance` had no RDAP record at the time of deployment and appear to be
available for registration if `kyrox.io` is not yours.
