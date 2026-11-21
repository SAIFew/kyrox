# ADR-0006: Environment and chain isolation

- **Status:** Accepted
- **Date:** 2026-11-21
- **Phase:** 0

## Context

The product phase is Base Sepolia only. Base Mainnet configuration exists solely
for read-only oracle ingestion. Mixing the two is a credible way to move real
funds or to publish a mainnet address as if it were a testnet deployment.

The audit also found that the existing server correctly rejects chain id `8453`.

## Decision

- The application writes only to Base Sepolia (`chainId 84532`).
- Base Mainnet (`8453`) is read-only and used only by the price service.
- Addresses live in per-chain manifests under `deployments/`.
- `deployments/base-sepolia.json` must never contain a mainnet address.
- Chain id and environment are validated at startup and on every write path.
- Separate environment variables, separate RPC URLs, and separate credentials
  are used per environment.
- A build for one environment refuses to start if it detects the other.

## Consequences

- A mainnet address in Sepolia config is a deployment defect, not a warning.
- Preview deployments cannot accidentally use production credentials.
- The price service is the only component allowed to hold a mainnet RPC URL.
- Operators must maintain two sets of secrets.

## Alternatives considered

- **One shared configuration with a chain switch.** Rejected: too easy to
  misconfigure and too dangerous for wallet operations.
