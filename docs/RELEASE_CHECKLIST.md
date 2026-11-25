# KYROX operational readiness and release checklist

Last reviewed: **2026-11-24**. This document is a release gate, not evidence that
a deployment occurred. No migration, contract deployment, manifest activation,
publication, Vercel deployment, commit, or push was performed by the DevOps pass.

## 1. Current truth

| Surface                | State                                                                                     | Release meaning                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Public preview         | Deployed and health-checked in simulated mode on 2026-11-24                               | The web app is live; markets, balances, fills, and activity are not live trading data |
| Base Sepolia contracts | Not deployed; `deployments/base-sepolia.json` is `unpopulated`                            | Live mode and publication cannot be promoted                                          |
| Price publication      | `PRICE_PUBLICATION_ENABLED=false` is the enforced default                                 | Keep false until deployment, roles, observations, and signing procedure are approved  |
| Market session         | `KYROX_MARKET_SESSION_MODE=unknown` fails closed                                          | A calendar is not integrated; testnet opt-in requires explicit approval               |
| Database               | `pnpm migrate` prefers `DIRECT_DATABASE_URL`, then falls back to `DATABASE_URL`           | Provision, back up, and migrate before a live release                                 |
| Serverless manifests   | Next tracing includes `base-sepolia.json`, plus generated `local-anvil.json` when present | Verify the emitted `.nft.json` files on every release build                           |
| Media payloads         | `.vercelignore` excludes `video/`, `content/`, and generated media formats                | Standalone media work stays out of web deployments                                    |
| Secret scanning        | Full history, tracked working tree, and safe untracked text coverage                      | Findings are metadata-only; never print matched values                                |
| Custom domain          | DNS re-verified 2026-11-24: expired nameservers and non-Vercel apex `A`                   | Repair DNS before claiming `kyrox.io` is live                                         |

### Local DevOps verification evidence (2026-11-24)

These checks were run locally; GitHub Actions itself was not executed.

| Check                                                      | Result                                                                                                                                                                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean detached `HEAD` build with the owned Next config     | Passed; both manifests found in all 33 emitted server traces                                                                                                                                               |
| CI-shaped clean build without generated `local-anvil.json` | Passed; `base-sepolia.json` found in all 33 emitted server traces                                                                                                                                          |
| Public preview health                                      | Passed; reachable at the Vercel URL in `demo` / simulated mode                                                                                                                                             |
| Clean live-mode build/start with a temporary manifest      | Passed; `/api/health` reported `live` / `base-sepolia` without RPC or database access                                                                                                                      |
| Marketing static build and Playwright validator            | Passed all viewport, metadata, navigation, keyboard, reduced-motion, network, and contrast checks                                                                                                          |
| Locked Python install and package verification             | Passed; 73 locked packages, `pip check`, wheel/sdist, isolated install, and STDIO handshake                                                                                                                |
| Python pytest                                              | 402 passed in the locked Python 3.13 environment                                                                                                                                                           |
| Foundry contracts                                          | 95 passed                                                                                                                                                                                                  |
| Tracked and untracked secret scans                         | Passed; 372 tracked files, 52 commits, and 46 untracked text files covered                                                                                                                                 |
| Migration command selection                                | Verified with a stub executable: direct URL wins, pooled URL is the fallback; no migration was run                                                                                                         |
| Current working-tree lint/format/typecheck/test            | Not green during source repair: Vitest 367 passed / 7 failed / 22 skipped (396); lint, format, and web typecheck still report product-source issues. No product source was edited or excluded to hide them |

## 2. Verified blockers

- [ ] **Base Sepolia deployment:** complete the reviewed runbook, Basescan
      verification, independent archive-RPC verification, and explicit manifest
      activation. The current manifest must remain unpopulated until then.
- [ ] **Archive RPCs:** provision two independently operated archive-capable Base
      Sepolia endpoints. A chain-id-only or pruned public endpoint is insufficient.
- [ ] **RPC log redaction:** `scripts/deploy-sepolia.ts` prints the full primary
      RPC URL in human output. The script is outside DevOps ownership. Use
      `--json` in shared logs until the lead redacts or removes that line.
- [ ] **Production PostgreSQL:** provision pooled and direct connections, backups,
      retention, alerting, and a tested restore. Run `pnpm migrate` from the
      release environment before switching traffic.
- [ ] **Market-session decision:** keep `unknown` for fail-closed behavior, or
      record founder approval for `always-open-testnet`. The latter is a testnet
      freshness-based opt-in, not a mainnet/calendar/24-7-price claim.
- [ ] **Publication approval:** keep `PRICE_PUBLICATION_ENABLED=false` until the
      first observation, calldata, role separation, external signing, and receipt
      verification procedure are approved.
- [ ] **Live-mode evidence:** green release-readiness CI, a live-mode build using
      a temporary manifest, health/assets smoke without external RPC, and emitted
      server traces containing the production manifest.
- [ ] **Browser evidence:** green consumer Playwright and marketing validator
      jobs. Marketing validation passed locally; consumer Playwright and GitHub
      CI still need a green run after the source repairs.
- [ ] **Domain/DNS:** re-verify the recorded `kyrox.io` misconfiguration and repair
      delegation or records before changing `NEXT_PUBLIC_APP_URL`.
- [ ] **Operational controls:** approve multisig/admin handover, pauser monitoring,
      rate limiting/trusted-proxy handling, and incident ownership before external
      beta.

## 3. Pre-release sequence

1. Freeze the reviewed commit and confirm `git status --short` contains no
   unexpected user work. Do not commit or push as part of this checklist.
2. Install reproducibly:
   ```bash
   pnpm install --frozen-lockfile
   ```
3. Run product gates:
   ```bash
   pnpm lint
   pnpm format:check
   pnpm typecheck
   pnpm test
   pnpm build
   pnpm build:marketing
   pnpm scan:secrets
   ```
4. Run browser gates against local services:
   ```bash
   pnpm local:e2e
   python3 -m http.server 4173 --directory apps/marketing/out
   # In a second terminal:
   pnpm validate:marketing
   ```
5. For Python packaging, combine the build constraints with the runtime lock and
   run the same locked install used by CI:
   ```bash
   CONSTRAINTS="$(mktemp)"
   trap 'rm -f "$CONSTRAINTS"' EXIT
   cat docs/ci/python-build-constraints.txt services/mcp-server/requirements-lock.txt >"$CONSTRAINTS"
   PIP_BUILD_CONSTRAINT="$PWD/docs/ci/python-build-constraints.txt" PIP_CONSTRAINT="$CONSTRAINTS" python -m pip install --upgrade --constraint "$CONSTRAINTS" pip build setuptools wheel
   PIP_BUILD_CONSTRAINT="$PWD/docs/ci/python-build-constraints.txt" PIP_CONSTRAINT="$CONSTRAINTS" python -m pip install --requirement services/mcp-server/requirements-lock.txt --constraint "$CONSTRAINTS" "services/mcp-server[dev]"
   python -m pip check
   python -m pytest -q services/mcp-server
   PIP_BUILD_CONSTRAINT="$PWD/docs/ci/python-build-constraints.txt" PIP_CONSTRAINT="$CONSTRAINTS" python scripts/verify-mcp-package.py
   ```
6. Inspect server traces after the web build:
   ```bash
   node --input-type=module <<'NODE'
   import { existsSync, readdirSync, readFileSync } from "node:fs";
   import path from "node:path";
   const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
     const file = path.join(dir, entry.name);
     return entry.isDirectory() ? walk(file) : entry.name.endsWith(".nft.json") ? [file] : [];
   });
   const traces = walk("apps/web/.next/server/app");
   const required = ["base-sepolia.json", ...(existsSync("deployments/local-anvil.json") ? ["local-anvil.json"] : [])];
   for (const trace of traces) {
     const { files = [] } = JSON.parse(readFileSync(trace, "utf8"));
     for (const manifest of required) {
       if (!files.some((file) => file.endsWith(`/deployments/${manifest}`) || file === `deployments/${manifest}`)) {
         throw new Error(`${trace} missing ${manifest}`);
       }
     }
   }
   console.log(`Verified ${traces.length} traces.`);
   NODE
   ```
7. Back up PostgreSQL, then apply migrations with the direct URL:
   ```bash
   pnpm migrate
   ```
   `DIRECT_DATABASE_URL` takes precedence; `DATABASE_URL` is only a fallback.
8. Build and start an isolated live-mode candidate with a temporary deployed
   manifest and a non-routable loopback RPC. Confirm `/api/health` reports
   `mode: live` and `/api/assets` reports `mode: base-sepolia` without contacting
   an RPC. Never overwrite `deployments/base-sepolia.json` for this smoke test.
9. Obtain explicit approval for the deployment target and environment variables.
   Only then may the release owner deploy. This DevOps pass does not deploy.

## 4. Live environment invariants

- `KYROX_DEMO_MODE=0` on the live candidate; the public preview stays at `1`.
- `KYROX_ENVIRONMENT=base-sepolia`.
- `APP_ORIGIN` is the exact HTTPS origin with no path, query, fragment, or credentials; it is used for SIWE host/URI binding and mutation `Origin` checks.
- `DATABASE_URL` is pooled; `DIRECT_DATABASE_URL` is non-pooled and migration-only.
- `AUTH_SECRET` is server-side and at least 32 characters.
- `KYROX_DEPLOYMENT_MANIFEST` resolves to an approved `status: deployed` manifest.
- `KYROX_MARKET_SESSION_MODE=unknown` unless the testnet opt-in is approved.
- `PRICE_PUBLICATION_ENABLED=false` until publication is approved.
- No secret or credentialed RPC URL is placed in a `NEXT_PUBLIC_*` variable or log.

## 5. Post-release verification

- [ ] `/api/health` returns 200, `mode: live`, and `environment.mode: base-sepolia`.
- [ ] `/api/healthz` returns 200 liveness without configuration details, and `/api/readyz` returns 200 only after the shared PostgreSQL pool answers a bounded `SELECT 1`.
- [ ] `/api/readyz` returns a generic 503 without secrets when the database is unavailable, and the public preview remains ready without a database or RPC.
- [ ] `/api/status` does not claim simulated preview data on the live candidate.
- [ ] `/api/assets` reads PostgreSQL and reports non-simulated mode; missing or
      stale observations remain visibly unavailable rather than being refreshed.
- [ ] A closed/unknown market session rejects quote/intent preparation unless the
      explicit testnet opt-in was approved.
- [ ] Publication remains disabled until the first approved publication.
- [ ] Pause/unpause and reset procedures are rehearsed against the explicit RPC.
- [ ] Public preview remains reachable and explicitly simulated.

## 6. Emergency commands

Always include the RPC URL and inspect the hardware-wallet prompt:

```bash
cast send <EXCHANGE_ADDRESS> "pause()" \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --ledger

cast send <EXCHANGE_ADDRESS> "resetObservation(address)" <STOCK_ADDRESS> \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --ledger

cast send <EXCHANGE_ADDRESS> "unpause()" \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --ledger
```

Pause blocks both trade directions. Recover only after pausing, resetting the bad
observation, publishing and verifying a fresh round, and confirming the incident
is resolved.

## 7. Platform and operator checks

- [ ] Migration `0006_good_squadron_supreme.sql` applied; `admin_roles`, `app_users`,
      `indexed_trades`, `indexed_claims`, `points_entries`, `policy_config`, and
      `admin_audit_log` exist.
- [ ] The first owner is created with `pnpm admin:grant`; the bootstrap wallet is not a
      shared hot wallet.
- [ ] Owner/Admin/Analyst/Support permissions match the documented matrix; an Analyst
      cannot open Settings or see emails.
- [ ] `/admin` returns 503 in preview mode and 403 for a signed non-admin wallet.
- [ ] Every privileged mutation writes `admin_audit_log` with before/after values.
- [ ] Policy remains inside the launch ceiling; the kill switch returns 423 for new quotes.
- [ ] `pnpm indexer:run` refuses an unpopulated/mismatched manifest, then indexes a confirmed
      block range and writes a checkpoint.
- [ ] A forced reorg test (or seeded stale checkpoint hash) rewinds and re-indexes without
      duplicating tx/log rows.
- [ ] Trade/claim indexing awards quest points and qualifies referrals only after a real trade.
- [ ] Weekly league ranks realised P&L with a three-trade minimum and says unrealised positions
      are not marked to market.
- [ ] Share-card endpoint requires a session and includes the exact testnet disclaimer.
- [ ] Feedback and data-deletion requests are handled; deletion removes personal rows and
      leaves an audit entry without the wallet address.
- [ ] External PostHog/Sentry remain disabled until approved project keys exist.
