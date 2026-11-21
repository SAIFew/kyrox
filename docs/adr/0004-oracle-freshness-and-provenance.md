# ADR-0004: Oracle provenance, freshness, and Sepolia publication

- **Status:** Accepted
- **Date:** 2026-11-21
- **Phase:** 0

## Context

Coinbase B20 tokenized-stock feeds on Base are Chainlink equity feeds that run
24/5. Outside market hours, on weekends, and during corporate actions, the feed
holds its last value and `updatedAt` stops advancing while the contract remains
callable. The real B20 tokens, registry, and Chainlink Coinbase feeds are
deployed on Base Mainnet, not Base Sepolia.

The product rule is explicit: never refresh an old price by copying it with a
new timestamp. Staleness must be judged from the original oracle timestamp.

## Decision

The price service will:

1. Read `latestRoundData()` from the approved Chainlink Coinbase feed on Base
   Mainnet, read-only.
2. Persist the original `updatedAt`, the Chainlink `roundId`, `answeredInRound`,
   the raw answer, feed decimals, feed address, and source chain id.
3. Persist a separate `observedAt` for when our service fetched the value.
4. Publish the reference price to Base Sepolia with the original source
   timestamp and round id, never a rewritten one.
5. Treat missing, zero, implausible, paused, or over-age values as invalid for
   quotes.

`sourceUpdatedAt` is the only timestamp used for freshness. `observedAt` is
operational metadata. A quote whose `sourceUpdatedAt` exceeds the configured
maximum age is blocked, not silently refreshed.

24/7 smoothed feeds will be investigated separately. They must not be assumed
to exist for a given ticker, chain, or feed type until verified.

## Consequences

- Weekend and holiday behaviour is visible and honest.
- Corporate-action freezes are handled as stale data, not as fresh prices.
- The system stores provenance sufficient to audit every quote.
- The price publisher must be idempotent and must never create a new round from
  a cached answer.
- Sepolia prices are explicitly non-native and must be labelled as such in the
  UI and API.

## Alternatives considered

- **Re-publish the last price every interval.** Rejected: it fabricates
  freshness and violates a core safety rule.
- **Use a Sepolia-native feed.** Not available for B20 equities at the time of
  the audit.
- **Assume 24/7 availability.** Rejected: Coinbase B20 feeds are 24/5.
