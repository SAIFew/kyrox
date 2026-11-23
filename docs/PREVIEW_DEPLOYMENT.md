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

The Vercel account currently has no verified custom domain. `kyrox.io` is registered at Hostinger
and renews through 2027, but its nameservers currently point to `ns1.dns-expired.com` /
`ns2.dns-expired.com`, so it does not resolve. If you control it:

1. Restore DNS in Hostinger (renew the hosting/DNS service if required).
2. In Vercel → Project `kyrox` → Settings → Domains, add `kyrox.io` and `www.kyrox.io`.
3. Either set the Hostinger nameservers to `ns1.vercel-dns.com` and `ns2.vercel-dns.com`, or add
   `A @ → 76.76.21.21` and `CNAME www → cname.vercel-dns.com`.
4. Update `NEXT_PUBLIC_APP_URL` to `https://kyrox.io` and redeploy.

`kyrox.app` and `kyrox.finance` had no RDAP record at the time of deployment and appear to be
available for registration if `kyrox.io` is not yours.
