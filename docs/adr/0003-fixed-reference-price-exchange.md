# ADR-0003: Fixed-reference-price mint/burn exchange

- **Status:** Accepted
- **Date:** 2026-11-21
- **Phase:** 0

## Context

The testnet MVP needs a trading venue that is deterministic, auditable, and
easy to reason about. The audit identified that no exchange exists and that the
pricing model was undefined.

AMMs introduce impermanent loss, routing, MEV, and liquidity assumptions that
are unnecessary for a testnet demonstration and hard to validate in seven days.

## Decision

Implement `KYROXExchange` as a fixed-reference-price mint/burn venue:

- The quote price comes from the validated reference feed.
- Users mint stock tokens with tUSDC, or burn stock tokens for tUSDC.
- A deterministic rounding rule applies in both directions. No fee is
  implemented: the "fee" anticipated here was not adopted (see ADR-0008).
- The contract quote view and `packages/core` must produce identical results
  for the same state.
- No AMM, no DEX aggregator, no external routing.

## Consequences

- Simple, testable quote mathematics.
- No liquidity pool or slippage model to secure.
- The exchange depends entirely on the correctness and freshness of the
  reference price.
- Fees and rounding must be specified before implementation and covered by
  parity tests.
- The design is testnet-only and is not a claim of production market structure.

## Alternatives considered

- **Constant-product AMM.** Rejected: unnecessary complexity and risk for the
  MVP.
- **Order book.** Rejected: requires matching infrastructure and market makers.
- **DEX aggregator.** Rejected by product decision.
