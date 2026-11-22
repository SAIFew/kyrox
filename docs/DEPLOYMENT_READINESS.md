# KYROX — Base Sepolia deployment readiness

Status: **not deployed**. `deployments/base-sepolia.json` is intentionally empty and
must stay empty until a deployment is explicitly approved.

## 1. Contract prerequisites

| Item                   | Requirement                                                             |
| ---------------------- | ----------------------------------------------------------------------- |
| Solidity               | `0.8.28` (pinned in `foundry.toml`)                                     |
| OpenZeppelin Contracts | `v5.6.1` (pinned in CI and docs)                                        |
| forge-std              | `v1.17.0`                                                               |
| Compiler settings      | optimizer on, 200 runs, `cancun`                                        |
| Verification           | Basescan verification required before any address is recorded           |
| Tests                  | `forge fmt --check`, `forge build --sizes`, `forge test -vvv` must pass |

Contracts to deploy: `TestUSDC`, one `TestStock` per enabled asset, `KyroxExchange`.

## 2. Role configuration

| Role                            | Holder                            | Notes                                                    |
| ------------------------------- | --------------------------------- | -------------------------------------------------------- |
| `DEFAULT_ADMIN_ROLE` (exchange) | Multisig or hardware-backed admin | Can list assets, set bands/freshness, reset observations |
| `PRICE_UPDATER_ROLE`            | Automated publisher only          | Must not be the same key as admin in production          |
| `PAUSER_ROLE`                   | Incident responder                | Monitoring should also be able to pause                  |
| `EXCHANGE_ROLE` on each token   | The exchange address only         | Revoke from an old exchange during migration             |
| `DEFAULT_ADMIN_ROLE` on tokens  | Same admin as exchange            | No unrestricted mint path exists                         |

Migration procedure: grant `EXCHANGE_ROLE` to the new exchange, verify a trade,
then revoke it from the old exchange. Revocation is tested.

## 3. Asset and token mapping

1. Deploy one `TestStock` per synthetic asset with the decimal precision recorded
   in `packages/core/src/assets.ts` (18 for the initial test set).
2. Record the address in `deployments/base-sepolia.json` and set the asset's
   `stockToken` in the core catalogue. A `null` token disables intent preparation.
3. List the token on the exchange with a mandatory price band:
   `listAsset(token, maxSourceAgeSeconds, minPrice, maxPrice)`.
4. Set `maxPriceDeviationBps` if the feed has a known update cadence.
5. Never place a Base Mainnet address in the Sepolia manifest.

## 4. Price source requirements

- Sepolia identity is pinned: genesis `0x0dcc9e089e30b90ddfc55be9a37dd15bc551aeee999d2e2b51414c54eaf934e4`,
  checkpoint 61,800,000 `0x486d04900ac2e7f6de0d2960cf1aae9095a2a60756e2dcddeac9aca33e26d7ce`.
  Evidence: `base/base` commit `76fa46dd…`, genesis JSON, Tenderly/OnFinality
  and the official Blockscout explorer. Two independent archive RPCs are
  required; a chain-id-only endpoint is never accepted.
- Source reads are Base Mainnet (`8453`) only, through verified Chainlink
  Coinbase tokenized-equity proxies.
- The L2 sequencer uptime feed `0xBCF85224fc0756B9Fa45aA7892530B47e10b6433`
  must report up, and the 3,600-second grace period must have elapsed, before a
  cycle may ingest.
- `sourceUpdatedAt` is the original feed timestamp; it is never rewritten.
- Feeds are 24/5. Weekends and corporate-action pauses leave the timestamp old,
  which the existing freshness policy must reject rather than relabel.
- Prices are USD total-return values. The quote is denominated in tUSDC under an
  explicit testnet assumption of 1 tUSDC = 1 USD reference unit.

## 5. Environment variables

See `.env.example`. Required for the full path:

| Variable                               | Purpose                                       |
| -------------------------------------- | --------------------------------------------- |
| `BASE_MAINNET_RPC_URL`                 | Read-only feed and sequencer reads            |
| `BASE_SEPOLIA_RPC_URL`                 | Chain-id proof and token `decimals()` reads   |
| `DATABASE_URL` / `DIRECT_DATABASE_URL` | Observation persistence and migrations        |
| `PRICE_ALLOWED_TICKERS`                | Assets the worker may ingest                  |
| `PRICE_MAX_SOURCE_AGE_SECONDS`         | Default freshness bound                       |
| `PRICE_INGEST_INTERVAL_SECONDS`        | Poll interval                                 |
| `PRICE_PUBLICATION_ENABLED`            | Must remain `false` until a deployment exists |
| `KYROX_DEPLOYMENT_MANIFEST`            | Path to the populated manifest                |
| `KYROX_TEST_DATABASE_URL`              | Disposable database for the integration suite |

No secret belongs in a `NEXT_PUBLIC_` variable.

## 6. Database readiness

1. Provision PostgreSQL and set `DATABASE_URL`.
2. Apply migrations: `pnpm --filter @kyrox/db exec drizzle-kit migrate`.
3. Verify the unique indexes exist:
   - `price_observations_source_round_unique`
   - `price_publications_asset_round_unique`
4. Run the integration suite:
   `KYROX_TEST_DATABASE_URL=... pnpm test:postgres`.
5. For a disposable local verification, use `pnpm test:postgres:local`. It
   installs nothing, starts a temporary cluster on a random loopback port,
   generates a runtime password, and removes the cluster in a trap. Verified
   against PostgreSQL 16.16 with all eight integration tests passing.
6. Backups and retention must be configured before storing real observations.

## 6a. One-shot CLI

```bash
BASE_MAINNET_RPC_URL=... \
DATABASE_URL=... \
PRICE_ALLOWED_TICKERS=tAAPL,tTSLA,tNVDA \
PRICE_MAX_SOURCE_AGE_SECONDS=3600 \
KYROX_DEPLOYMENT_MANIFEST=deployments/base-sepolia.json \
pnpm price:ingest
```

The CLI runs exactly one cycle: config validation, Base Mainnet chain check,
sequencer gate (3,600 s grace), feed reads, validation, normalization, Drizzle
persistence, then publication preparation from the latest valid observation.
Exit codes: `0` successful cycle (including zero new rounds or blocked
publication), `1` per-asset or publication failure, `2` configuration/database
initialisation failure, `3` sequencer blocked.

`pnpm price:ingest:e2e` runs it against a temporary PostgreSQL cluster and a
read-only public Base RPC. It applies migrations first and never writes onchain.

## 6b. Deployment dry run

```bash
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org \
SEPOLIA_ADMIN_ADDRESS=0x... \
SEPOLIA_PRICE_UPDATER_ADDRESS=0x... \
SEPOLIA_PAUSER_ADDRESS=0x... \
pnpm deploy:sepolia:dry-run
```

Read-only. The command rejects any chain other than 84532, derives the order
(`TestUSDC` → one `TestStock` per asset → `KyroxExchange`), constructor
arguments and creation-bytecode hashes from compiled artifacts, prints role and
asset configuration, and writes `deployments/base-sepolia.proposed.json`.
That file is a planning artifact: every address is `null`, the environment is
`base-sepolia-proposal`, it is git-ignored, and it fails the production manifest
validator. `deployments/base-sepolia.json` is never touched.

## 6c. Deployment evidence, pending record and activation

After an approved external deployment, create
`deployments/base-sepolia.deployment-evidence.json` and run:

```bash
BASE_SEPOLIA_RPC_URL=... BASE_SEPOLIA_RPC_URL_SECONDARY=... \
DEPLOYMENT_CONFIRMATIONS=12 pnpm verify:sepolia-deployment
```

The command is read-only. It verifies pinned chain identity, receipt success and
confirmations, canonical block hashes, approved deployer, exact initcode
(creation bytecode plus constructor arguments), creation-bytecode hash, runtime
bytecode (immutables masked), zero initial token supply, token metadata, roles,
settlement token, paused state and per-asset freshness/bounds/deviation. On
success it writes `deployments/base-sepolia.verified-pending.json`
(`verified_pending_activation`), which is still not a live manifest.

Activation is a separate explicit action:

```bash
pnpm activate:sepolia-manifest --confirm
```

It re-verifies chain identity, each receipt/block hash/code/confirmation depth,
requires the pending record's proposal hash to match the reviewed proposal,
refuses to overwrite an existing deployed manifest without `--overwrite`, and
writes a timestamped backup of any existing file first. The promoted manifest must pass the
production loader. See `docs/BASE_SEPOLIA_DEPLOYMENT_RUNBOOK.md` (not executed).

## 7. Publication procedure

1. Ingestion stores a valid observation with source provenance.
2. `prepareSetPricePublication` validates status, source chain, round, timestamps,
   price band and freshness window, then encodes unsigned calldata.
3. A human reviews the calldata and the observation; duplicate rounds are refused.
4. Signing is a separate, explicitly approved step performed by the authorized
   publisher key. Nothing in this repository signs or broadcasts.
5. After inclusion, run
   `pnpm price:verify-publication --asset tAAPL --round 123 --tx-hash 0x...`.
   It checks the manifest, chain, destination, calldata hash, arguments, event,
   observation provenance and confirmation depth (default 3, configurable with
   `--confirmations`/`VERIFY_CONFIRMATIONS`). Only then is the row marked
   `verified`; a receipt alone is not proof.

Local rehearsal: `pnpm e2e:publication` starts a temporary PostgreSQL cluster and
a temporary Anvil chain. It persists a **simulated** observation through
`DrizzleObservationStore`, loads it back, prepares the unsigned publication,
executes it with an unlocked disposable account, and reads every field back
through `observation(token)`. It also verifies duplicate, older, stale and
malformed rejection and records the publication row. The manifest is written to
`deployments/local-anvil.json` (git-ignored, `environment: local-anvil`). The
chain id being 84532 does not make it a Base Sepolia deployment.

## 8. Emergency pause and recovery

- `PAUSER_ROLE` pauses both `buy` and `sell`; quotes and prepared intents then
  fail closed.
- A frozen or broken feed stops trading through the freshness check. Freeze an
  asset explicitly with `setMaxSourceAge(token, 0)`.
- Recovery from an unusable observation: pause, `resetObservation(token)`,
  publish a fresh round, then unpause.
- On a corporate action, expect the feed to hold its last value; do not force a
  new timestamp.

## 9. Known limitations and accepted risks

- No deployment exists; publication and real intents are disabled by design.
- Trade-size policy (1 / 1,000 / 5,000 tUSDC) is enforced off-chain only; direct
  contract calls bypass it. This is documented, not claimed as on-chain.
- Administration is single-step `AccessControl`; production should use a
  multisig and a delayed handover.
- The settlement token is checked for 6 decimals, not its mint/burn interface.
- No sweep function: tokens sent directly to the exchange are unrecoverable.
- The `Trade` event amounts are side-relative; indexers must key on `isBuy`.
- 24/7 feed variants exist but are not enabled.
- No L2 sequencer check is applied on Sepolia execution (the gate protects source
  ingestion).
- PostgreSQL integration and the CLI are verified against temporary local
  clusters (16.16), not against the eventual production instance.
- The publication rehearsal uses simulated observations, not Chainlink data.
- The CLI prepares calldata but has no signing or submission step by design.
