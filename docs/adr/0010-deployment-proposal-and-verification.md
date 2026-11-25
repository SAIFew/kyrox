# ADR-0010: Deployment proposal and publication verification lifecycle

- **Status:** Accepted
- **Date:** 2026-11-21
- **Phase:** 2 (pre-deployment)

## Context

KYROX now has an operational ingestion/publishing path, but no deployment. Two
gaps remained: a reproducible deployment plan without broadcasting, and a way to
verify a price publication that was signed and submitted outside this codebase.

## Decision

### Stages are explicit and separate

1. **Proposal** — `pnpm deploy:sepolia:dry-run --json` reads compiled artifacts,
   verifies pinned chain identity through two independent archive-capable RPCs,
   and writes `deployments/base-sepolia.proposed.json`. It sends nothing. The
   manifest has `environment: base-sepolia-proposal`, `status: not_deployed`, and
   `address: null` everywhere. Use `--json` in shared logs until the human-output
   RPC URL is redacted.
2. **Approval** — a human reviews the plan, roles, constructor arguments and
   proposed manifest.
3. **Deployment** — performed separately, with an approved signer. This
   repository contains no deployment transaction sender.
4. **Unsigned publication** — after explicit approval sets
   `PRICE_PUBLICATION_ENABLED=true`, `prepareSetPricePublication` produces
   calldata and a deterministic `PublicationArtifact` containing chain, exchange,
   calldata, value, asset, round, source timestamp, hashes and expected
   event/observation. The enforced default remains `false`.
5. **External signing** — the authorized publisher key signs outside this
   repository. No key material exists here.
6. **Inclusion** — the transaction is mined. A receipt alone proves execution,
   not correctness.
7. **Verification** — `pnpm price:verify-publication` re-derives everything:
   manifest, exchange, destination, calldata hash, function arguments, event,
   on-chain observation, source provenance and confirmation depth.

### Proposal manifests are not deployments

A proposal must fail `parseDeploymentManifest`. Both ingestion and verification
reject manifests whose environment is not an approved deployment, and the
proposed file is git-ignored. Chain id `84532` alone never implies Sepolia.

### Publication lifecycle

`price_publications` stores an immutable snapshot of the prepared observation
(asset, token, price, round, source timestamp, source chain, feed, simulated,
observed time) plus lifecycle state:

`prepared → submitted → included → confirmed → verified`
with `failed` and `verification_failed` as terminal failure states.

`transaction_hash` is unique across publications. A failed verification cannot
overwrite a `verified` row: the lifecycle update is guarded. Re-running
verification is idempotent.

### Chain identity, creation code and state machine

Verification additionally requires pinned Base Sepolia genesis/checkpoint
agreement from two independent archive RPCs, the approved deployer, exact
initcode and creation hash, zero constructor mint, and a configurable deployment
confirmation depth. Publication transitions use compare-and-swap against the
expected status, are appended to a transition history table, never downgrade a
verified row, and move reorged publications to a distinct `reorged` state while
preserving verification evidence.

### Confirmation and reorg handling

Verification requires a configurable confirmation depth (default 3). Below the
threshold the record is `included`, not `verified`. A changed inclusion block
hash is treated as a reorg and reported; a verified record is never silently
downgraded. Missing receipts and reverted transactions fail closed with precise
reasons.

### Operator runbook and evidence

`docs/BASE_SEPOLIA_DEPLOYMENT_RUNBOOK.md` documents the exact transaction
sequence with Foundry v1.10.0 hardware-wallet commands (`forge create --ledger`,
`cast send --ledger`), placeholders, expected events and post-state checks. The
runbook has not been executed.

After deployment, the operator supplies addresses and transaction hashes in a
git-ignored evidence file. `verify:sepolia-deployment` checks receipts, runtime
bytecode (immutables masked), constructor arguments, metadata, roles and asset
configuration, then writes a pending record. Activation is a separate command
requiring `--confirm`, a proposal-hash match, and a backup before replacing any
existing deployed manifest. Incomplete records never reach the production
loader.

## Consequences

- Deployment cannot be confused with planning.
- Publication correctness is re-derived from chain state, not trusted from a
  receipt.
- The local Anvil rehearsal exercises the same lifecycle as production.
- A real Base Sepolia deployment still requires explicit approval, a populated
  manifest, and an external signer.
