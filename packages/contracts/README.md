# Contracts (Foundry)

Phase 0 scaffold only. **No contracts exist and nothing has been deployed.**

## Status

- `src/` is empty by design.
- `test/` and `script/` are empty by design.
- No RPC endpoint, keystore, or deployment key is configured.
- `deployments/base-sepolia.json` is intentionally unpopulated.

## Planned contracts (not implemented)

| Contract        | Purpose                         | Notes                            |
| --------------- | ------------------------------- | -------------------------------- |
| `TestUSDC`      | 6-decimal test settlement token | Mintable with caps and roles     |
| `StockToken`    | 18-decimal test stock token     | Symbols/decimals configurable    |
| `KYROXExchange` | Fixed-reference-price mint/burn | No AMM, no DEX routing           |
| `Faucet`        | tUSDC claims                    | Cooldown and per-address limits  |
| `MockOracle`    | Test-only feed                  | Must be labelled as a simulation |

## Rules

- Never deploy from this repository without explicit approval.
- Never copy a Base Mainnet address into a Base Sepolia file.
- Real B20 tokens and Chainlink Coinbase feeds are Base Mainnet only. Base
  Sepolia uses mocks that are clearly labelled.
- Read token decimals and multiplier semantics from deployed contracts; do not
  assume them in application code.

## Commands

```bash
forge fmt --check
forge build
forge test
```

Foundry is installed by CI. It is not required for the JavaScript workspace.
