# ADR-0007: Workspace layout and decimal policy

- **Status:** Accepted
- **Date:** 2026-11-21
- **Phase:** 0

## Context

The consumer application needs a clear separation between the web surface,
deterministic domain logic, persistence, contracts, and background services.
Token decimals differ by asset: tUSDC uses 6, the Phase 0 test stock token uses
18, and future B20 stock tokens may use 8 decimals and carry a multiplier.

## Decision

Use a pnpm workspace with these boundaries:

| Path                 | Responsibility                             |
| -------------------- | ------------------------------------------ |
| `apps/web`           | Next.js App Router consumer application    |
| `packages/core`      | Quote, policy, decimals, shared types      |
| `packages/db`        | Drizzle schema and PostgreSQL access       |
| `packages/contracts` | Foundry contracts and deployment manifests |
| `services/agent`     | Read/quote-only LLM tool orchestration     |
| `services/indexer`   | Onchain event ingestion                    |
| `services/price`     | Oracle ingestion and provenance            |

Decimal rules:

- tUSDC is 6 decimals.
- Phase 0 test stock tokens are 18 decimals unless a documented decision
  changes it.
- Every conversion function takes an explicit `decimals` argument.
- Future B20 integration reads `decimals()` and multiplier semantics from the
  deployed contract. Nothing assumes 18 or 1:1 share equivalence.

## Consequences

- A single conversion utility prevents decimal drift across packages.
- Tests must cover 6, 8, and 18 decimals even before an 8-decimal token exists.
- B20 multiplier handling is a later, explicitly designed change.

## Alternatives considered

- **One flat package.** Rejected: hides boundaries and encourages duplicated
  rules.
- **Assume 18 decimals everywhere.** Rejected: tUSDC is 6 and B20 stocks are
  reported as 8.
