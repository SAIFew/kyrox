# ADR-0008: Exchange math, rounding, and observation publication

- **Status:** Accepted
- **Date:** 2026-11-21
- **Phase:** 1

## Context

ADR-0003 fixed the venue model (fixed-reference-price mint/burn, no AMM) but
left the arithmetic, rounding, decimal handling, and on-chain provenance
undefined. The TypeScript core and the Solidity exchange must agree exactly,
otherwise a quote shown to a user could differ from what the contract executes.

## Decision

### Price convention

One price only: the price of **one whole stock token**, denominated in USDC,
expressed in **6-decimal USDC units**. `230_000_000` means 230.000000 USDC per
whole token, independent of the stock token's decimals.

### Formulas

Let `p` be that price, `d` the stock token's decimals, and `S = 10^d`.

- Buy: `stockOut = floor(usdcIn * S / p)`
- Sell: `usdcOut = floor(stockIn * p / S)`
- Minimum output: `minOut = floor(quoted * (10_000 - bps) / 10_000)`

`bps` is capped at 1,000 (10%). Every division floors, so the venue never pays
out more than the exact value. Both implementations use 256-bit integer math
(`Math.mulDiv` on-chain, `bigint` off-chain). No floating point is permitted.

### No fee

The specification defines no fee, so none is implemented. Adding one later is a
product decision requiring a new ADR and parity vectors.

### Decimals

- tUSDC is 6 decimals and the exchange verifies this at construction.
- The exchange reads `decimals()` from each stock token when the token is
  allowlisted and stores the value; nothing assumes 18 or 8.
- The TypeScript engine supports 6, 8 and 18 decimal assets today, and its
  conversion helpers take an explicit decimals argument.
- Future B20 integration must read decimals and multiplier semantics from the
  deployed token rather than assuming them. Multipliers are not modelled yet.

### Observation provenance

`setPrice` stores:

| Field                    | Meaning                                                 |
| ------------------------ | ------------------------------------------------------- |
| `priceUsdcPerWholeToken` | Validated reference price                               |
| `sourceRoundId`          | Round id from the original source                       |
| `sourceUpdatedAt`        | **Original** source timestamp, preserved verbatim       |
| `publishedAt`            | Sepolia block timestamp of publication                  |
| `sourceChainId`          | Chain the observation was read from (8453 or 84532)     |
| `feedAddress`            | Source feed, or zero for a labelled simulation          |
| `simulated`              | True when the value is a simulation, never a feed price |

`sourceUpdatedAt` is never replaced with `block.timestamp`. Publication time is a
separate field so a stale observation cannot be made to look fresh.

### Replay and freshness rules

- `sourceRoundId` must be strictly greater than the previously stored round.
- `sourceUpdatedAt` must be non-decreasing across publications.
- Zero, future, and zero-chain provenance values are rejected.
- A non-simulated observation must carry a feed address.
- At trade time, `block.timestamp - sourceUpdatedAt` must not exceed the asset's
  `maxSourceAgeSeconds`; freshness is configured per asset.
- A 24/5 feed holding its last value over a weekend therefore becomes stale and
  blocks trading instead of silently quoting.

### Price plausibility

Every asset has a mandatory price band (`minPriceUsdcPerWholeToken`,
`maxPriceUsdcPerWholeToken`) set at listing. `setPrice` rejects anything outside
it, so a unit error (for example an 8-decimal answer treated as 6-decimal) or a
compromised publisher cannot make an implausible price tradable.

An optional `maxPriceDeviationBps` guard rejects a jump larger than the
configured share of the previous price. It is disabled at 0 and capped at
10,000 bps (100%). Operators should enable it for assets with a known feed
schedule.

### Publication rules

- An observation that is already older than the asset's freshness bound is
  refused at publication, so a dead feed cannot overwrite a good price.
- `maxSourceAgeSeconds` is capped at 7 days. Setting it to 0 freezes the asset.
- A frozen or otherwise unusable observation can be cleared with
  `resetObservation`, which is restricted to the admin role and requires the
  exchange to be paused. This is an explicit incident-recovery action.

### Trade-time protections

- Both entry points take a `deadline`; a transaction included after it reverts.
- Both entry points verify the delivered balance delta equals the requested
  amount, so a fee-on-transfer or lying token cannot short-change the venue.
- Tokens may only burn their own balance: `burnByExchange(from)` requires
  `from == msg.sender`, so the exchange role cannot wipe a holder's balance.

### Enforcement split

Trade-size policy (1 tUSDC minimum, 1,000 maximum, 5,000 daily) is enforced by
the TypeScript API layer, not by the contract. The contract is a public testnet
venue; anyone can call it directly. These limits must not be described as
on-chain controls.

### Access control and pause

- `DEFAULT_ADMIN_ROLE` allowlists assets and sets freshness bounds.
- `PRICE_UPDATER_ROLE` publishes observations.
- `PAUSER_ROLE` pauses and unpauses; both `buy` and `sell` are `whenNotPaused`
  and `nonReentrant`.
- Tokens grant `EXCHANGE_ROLE` only to the exchange; there is no unrestricted
  mint path.

### Cross-language parity

`packages/core/fixtures/golden-quotes.json` is the shared source of truth.
Vitest and Foundry both iterate the same vectors, so a divergence between the
TypeScript quote and the Solidity quote fails CI.

## Consequences

- One arithmetic definition, testable on both sides.
- Flooring means dust accrues to the venue side of the trade; this is
  intentional and bounded by one base unit per operation.
- Decimal changes require re-listing an asset, because decimals are pinned at
  listing time.
- Freshness is per asset, so 24/5 and 24/7 feeds can coexist without a global
  assumption.

## Alternatives considered

- **Round half-up.** Rejected: it can pay out more than the exact value.
- **Read `decimals()` on every trade.** Rejected: extra external call per trade
  for a value that cannot change in our token design.
- **One global freshness bound.** Rejected: it forces a false assumption about
  every feed's schedule.
