# Contracts (Foundry)

Solidity implementation of the KYROX Base Sepolia testnet venue.

**No contract is deployed.** `deployments/base-sepolia.json` is intentionally
unpopulated, and this repository contains no deployment script that broadcasts.

## Contracts

| Contract                               | Purpose                                                                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/TestUSDC.sol`                     | 6-decimal settlement token. `claimWelcome()` pays 1,000 tUSDC once; `claimDaily()` pays 100 tUSDC per 24-hour period. Mint/burn restricted to `EXCHANGE_ROLE`. |
| `src/TestStock.sol`                    | Stock token with decimals fixed at construction (6, 8 or 18). Mint/burn restricted to `EXCHANGE_ROLE`; no unrestricted mint path.                              |
| `src/KyroxExchange.sol`                | Fixed-reference-price mint/burn. Per-asset freshness, round monotonicity, pause, provenance, reentrancy guard.                                                 |
| `src/interfaces/IKyroxPriceSource.sol` | Feed-independent observation interface.                                                                                                                        |
| `src/interfaces/ITestUSDC.sol`         | Settlement token surface used by the exchange.                                                                                                                 |
| `src/interfaces/ITestStock.sol`        | Stock token surface used by the exchange.                                                                                                                      |

## Arithmetic

Price is USDC per one whole stock token in 6-decimal units.

- `buy`: `stockOut = floor(usdcIn * 10^decimals / price)`
- `sell`: `usdcOut = floor(stockIn * price / 10^decimals)`

All divisions floor. There is no fee. See
[ADR-0008](../../docs/adr/0008-exchange-math-and-observation-publication.md).

## Listing and price controls

`listAsset(token, maxSourceAgeSeconds, minPrice, maxPrice)` reads the token's
decimals and stores a mandatory plausibility band. `setPriceBounds` updates the
band and an optional `maxDeviationBps` guard (0 disables, max 10,000).

`setMaxSourceAge(token, 0)` freezes an asset. `resetObservation(token)` clears an
unusable observation and requires the exchange to be paused.

## Provenance

`setPrice` stores `sourceRoundId`, the original `sourceUpdatedAt`, a separate
`publishedAt`, `sourceChainId`, `feedAddress`, and a `simulated` flag.
`sourceUpdatedAt` is never replaced with `block.timestamp`. Rounds must strictly
increase and source timestamps must not go backwards.

## Dependencies (pinned)

| Dependency             | Version |
| ---------------------- | ------- |
| Solidity               | 0.8.28  |
| OpenZeppelin Contracts | v5.6.1  |
| forge-std              | v1.17.0 |

`lib/` is git-ignored, so install dependencies before building:

```bash
forge install OpenZeppelin/openzeppelin-contracts@v5.6.1 --no-git
forge install foundry-rs/forge-std@v1.17.0 --no-git
```

## Commands

```bash
forge fmt --check
forge build --sizes
forge test -vvv
```

## Test layout

| File                       | Covers                                                             |
| -------------------------- | ------------------------------------------------------------------ |
| `test/TestUSDC.t.sol`      | Faucets, cooldowns, decimals, role-gated mint/burn                 |
| `test/TestStock.t.sol`     | Decimals, role-gated mint/burn, no unrestricted mint               |
| `test/KyroxExchange.t.sol` | Listing, provenance, replay, freshness, trading, pause, reentrancy |
| `test/GoldenVectors.t.sol` | Parity with `packages/core/fixtures/golden-quotes.json`            |
| `test/Fuzz.t.sol`          | Floor arithmetic, monotonicity, decimals, round-trip safety        |

## Known limits

- Trade-size policy (1 / 1,000 / 5,000 tUSDC) is enforced off-chain only. The
  contract is a public testnet venue; direct callers are not subject to it.
- Administration is single-step `AccessControl`. A production deployment should
  move the admin role to a multisig and consider a delayed two-step handover.
- The settlement token is checked for 6 decimals at construction but its
  mint/burn interface is not probed.
- There is no sweep function: tokens sent directly to the exchange are stuck.
- `Trade.usdcAmount` is the USDC moved by the trade and `Trade.stockAmount` the
  stock moved: on a buy they are input/output, on a sell they are output/input.
  Indexers must key on `isBuy` rather than assuming an input/output position.

## Rules

- Never deploy from this repository without explicit approval.
- Never copy a Base Mainnet address into a Base Sepolia file.
- Real B20 tokens and Chainlink Coinbase feeds are Base Mainnet only; Sepolia
  uses labelled mocks and published observations.
- Read token decimals from the deployed contract; never assume them.
