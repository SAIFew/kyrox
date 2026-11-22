# ADR-0009: Price ingestion, provenance, and quote-to-intent binding

- **Status:** Accepted
- **Date:** 2026-11-21
- **Phase:** 1

## Context

ADR-0004 fixed the freshness and provenance rules but left ingestion, storage,
publication preparation, and intent binding unimplemented. The exchange now
exists, so off-chain code needs a verified read path from Base Mainnet, durable
observations, and a way to prepare unsigned Sepolia calls without ever holding a
key.

## Decision

### Source feeds are verified, not assumed

Only Chainlink Coinbase tokenized-equity feeds on Base Mainnet (8453) are used.
Each proxy was checked against Chainlink's reference data directory and Base's
documentation, then verified live on 2026-11-21: contract code present,
`decimals() == 8`, matching `description()`, positive answer, and
`answeredInRound == roundId`.

| Synthetic asset | Reference | Feed proxy                                   |
| --------------- | --------- | -------------------------------------------- |
| `tAAPL`         | AAPL      | `0x787f13dEa48Db0897CbCDD985de77809D837F988` |
| `tTSLA`         | TSLA      | `0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4` |
| `tNVDA`         | NVDA      | `0x04689a41629776563E6822F76f2e57D148d28513` |

The synthetic assets are **not** Coinbase B20 tokens. The mapping only binds a
synthetic testnet asset to the reference feed whose value it mirrors.

Other verified Coinbase feeds (AMZN, GOOGL, META, MSFT, MSTR, SNDK, SPCX, INTC,
COIN, CRCL) exist on Base Mainnet but have no synthetic asset, so they are not
enabled. 24/7 feed variants exist for GOOGL, NVDA and TSLA but are not enabled:
the product has not decided to trade outside equity sessions.

### Total-return values are not adjusted twice

The feed already reports a total-return value with Coinbase's multiplier
applied. Ingestion therefore performs one conversion only: raw answer with
`feedDecimals` to 6-decimal USDC units, flooring. No multiplier is re-applied.

### Testnet pricing assumption

The source price is denominated in USD. The quote is denominated in tUSDC. For
this testnet phase we assume **1 tUSDC = 1 USD reference unit**, an explicit
testnet simplification, not a market peg. Both the assumption and the source
currency are recorded in documentation and must be surfaced in the UI.

### Persistence

`price_observations` stores the asset, source chain, feed, raw answer, feed
decimals, source round id, original `sourceUpdatedAt`, local `observedAt`,
normalized 6-decimal price, source description, status, and validation error.

A unique index on `(sourceChainId, feedAddress, sourceRoundId)` makes ingestion
idempotent. A unique index on `(assetSymbol, sourceRoundId)` makes publication
preparation idempotent. Invalid observations are stored with status `invalid`;
they can never replace a valid row because the unique key is the same.

`price_ingestion_events` records every poll outcome: published, duplicate,
invalid, rpc_error, store_error. `price_publications` records prepared calldata
hashes only.

### Ingestion

Before each cycle the worker checks the Base Mainnet L2 sequencer uptime feed
(`0xBCF85224fc0756B9Fa45aA7892530B47e10b6433`). Answer `0` with a 3,600-second
recovery grace period is required; anything else records a `sequencer_blocked`
or `sequencer_error` event and refuses the cycle. A successful RPC response is
never treated as proof of health.

Scheduling is sequential: the next poll is scheduled only after the previous
cycle settles, and `runOnce` coalesces concurrent callers. A slow cycle cannot
overlap itself.

The operational entrypoint is a one-shot CLI (`pnpm price:ingest`). It runs one
cycle and exits; no daemon is started. Publication preparation requires a
manifest whose environment is `local-anvil` (loopback RPC enforced) or an
explicitly populated `base-sepolia` manifest. A chain id of 84532 alone is never
treated as proof of a Sepolia deployment, and the empty Base Sepolia manifest
keeps production publication blocked.

The worker polls each enabled feed on a configurable interval and:

- never rewrites `sourceUpdatedAt`;
- never creates a new observation when the round has not advanced;
- stores invalid observations and failures instead of dropping them;
- continues across per-asset failures;
- is restart-safe because writes are idempotent.

Freshness is not decided at ingestion. A weekend or corporate-action freeze
stores the old `sourceUpdatedAt`, and the existing quote/policy freshness rules
decide usability.

### Publication is preparation only

`prepareSetPricePublication` validates a stored observation and encodes an
unsigned `setPrice` call using the exact contract ABI. It refuses when no Base
Sepolia deployment manifest exists. It has no signer, wallet client, or
submission function; there is a source-level test asserting those symbols are
absent.

Duplicate rounds are rejected against the store and against an optional
last-published round id.

`simulated` defaults to false, and a production publication must reference a
non-zero feed. Local rehearsal may pass `simulated: true` only with a zero feed
address, so a simulation can never be labelled as a deployed feed.
`pnpm e2e:publication` exercises this path end-to-end on Anvil and writes a
git-ignored `deployments/local-anvil.json`.

### Intent binding

`prepareTradeIntent` revalidates at approval time instead of trusting a displayed
quote:

- RPC chain and quote chain must both be 84532.
- The asset's deployed token must match the quote's bound stock token.
- On-chain `decimals()` must equal the quote's decimals.
- The quote is recomputed from the current observation and must match exactly.
- Policy is re-evaluated, including pause, allowlist, limits, freshness, and the
  UTC day.
- The deadline may not exceed the quote's expiry.
- Calldata is encoded for the exact token, direction, amount, minimum output, and
  deadline, and deterministic keccak256 hashes bind both the quote and the
  intent fields.

The returned object is unsigned. The user's wallet remains the only signer.

## Consequences

- Ingestion and publication can be tested entirely with fakes; no credentials
  are needed.
- Deployment is the only missing input; until then publication fails closed.
- The USD/tUSDC assumption is explicit and can be replaced by a documented
  reference rate later.
- Mainnet reads and Sepolia writes remain separate clients.

## Alternatives considered

- **Store only the latest price.** Rejected: destroys provenance and P&L history.
- **Re-stamp timestamps at publication.** Rejected: fabricates freshness.
- **Let the intent service trust the quote.** Rejected: a stale or tampered quote
  would become a signed trade.
- **Enable 24/7 feeds silently.** Rejected: changes staleness semantics and needs
  a product decision.
