# ADR-0002: TypeScript core is the source of truth

- **Status:** Accepted
- **Date:** 2026-11-21
- **Phase:** 0

## Context

The audit found that trading policy currently lives only in Python
(`tools/policy.py`). The new consumer product needs deterministic quote and
policy logic that the web app, the indexer, the agent service, and eventually
the MCP server can share.

Maintaining two independent rule implementations would create drift: a quote
accepted by one surface could be rejected by another, or worse, both could
accept a trade that should have been blocked.

## Decision

`packages/core` (TypeScript) is the single source of truth for:

- quote mathematics;
- policy evaluation;
- amount and decimal conversion;
- shared types and invariants.

The Solidity exchange must match `core` on shared golden vectors. The Python
MCP server must not re-implement trading rules; it becomes an adapter that
calls the `kyrox-app` API or consumes published test vectors.

## Consequences

- One rule set, one test suite, one set of edge cases.
- Contract/application parity becomes an explicit, tested requirement.
- The Python package loses trading-rule ownership, which is a deliberate
  reduction in scope.
- Cross-language parity requires versioned golden vectors until the adapter is
  complete.

## Alternatives considered

- **Python remains authoritative.** Rejected: the consumer backend is
  TypeScript and would need a network hop for every quote.
- **Duplicate logic in both languages.** Rejected: unacceptable divergence risk
  for financial rules.
