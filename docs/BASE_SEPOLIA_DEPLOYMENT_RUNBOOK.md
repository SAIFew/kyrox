# KYROX — Base Sepolia deployment runbook

**Status: NOT EXECUTED.** No contract is deployed, no role is granted, no price is
published, and `deployments/base-sepolia.json` must remain unpopulated until an
explicit founder approval and a completed run of this procedure.

This runbook is derived from `packages/contracts/src/*.sol`, the compiled
artifacts, and the reviewed dry-run proposal. Commands use placeholders in
`<ANGLE_BRACKETS>`; never paste a real key.

---

## 0. Prohibitions

- No private key may enter this repository, a shell history file, or an
  environment variable.
- No signing from OpenCode/Antigravity. All signatures happen on an external
  hardware wallet or an externally controlled account.
- No automatic broadcasting. Every transaction is inspected before signing.
- Never write to Base Mainnet from this runbook.

## 1. Roles and addresses

| Role                                 | Holder                           | Recommendation                               |
| ------------------------------------ | -------------------------------- | -------------------------------------------- |
| `DEFAULT_ADMIN_ROLE` (all contracts) | `<ADMIN_ADDRESS>`                | Multisig; single-step `AccessControl` today  |
| `PRICE_UPDATER_ROLE` (exchange)      | `<PRICE_UPDATER_ADDRESS>`        | Dedicated automated publisher key            |
| `PAUSER_ROLE` (exchange)             | `<PAUSER_ADDRESS>`               | Incident responder; may equal monitoring key |
| `EXCHANGE_ROLE` (each token)         | deployed `KyroxExchange` address | Granted only after deployment                |

Write these into `.env.local`-style shell variables in the operator's own
session (never commit):

```bash
export BASE_SEPOLIA_RPC_URL="<BASE_SEPOLIA_RPC_URL>"
export BASE_SEPOLIA_RPC_URL_SECONDARY="<INDEPENDENT_ARCHIVE_RPC>"
export ADMIN_ADDRESS="<ADMIN_ADDRESS>"
export PRICE_UPDATER_ADDRESS="<PRICE_UPDATER_ADDRESS>"
export PAUSER_ADDRESS="<PAUSER_ADDRESS>"
export DEPLOYER_ADDRESS="<APPROVED_DEPLOYER_ADDRESS>"
export SEPOLIA_DEVIATION_BPS="tAAPL:<BPS>,tTSLA:<BPS>,tNVDA:<BPS>"
export DEPLOYMENT_CONFIRMATIONS=12
export BASESCAN_API_KEY="<BASESCAN_API_KEY>"
```

Both RPCs must be independently operated and archive-capable; the verifier pins
genesis `0x0dcc9e…34e4` and checkpoint 61,800,000
`0x486d04…d7ce`. Do not use a provider that prunes block zero. The deployer
address must be the hardware-wallet address used for every `forge create`.

`ADMIN_ADDRESS`, `PRICE_UPDATER_ADDRESS` and `PAUSER_ADDRESS` must be different
keys unless the risk is explicitly accepted. **Single-step admin risk:** losing
the admin key or renouncing it bricks administration; there is no delayed
handover. Do not renounce roles.

## 2. Preflight

```bash
git status --short
pnpm install --frozen-lockfile
pnpm check
forge fmt --check
forge build --sizes
forge test -vvv
```

Generate and review the proposal:

```bash
pnpm deploy:sepolia:dry-run
```

Review `deployments/base-sepolia.proposed.json`:

- `environment` must be `base-sepolia-proposal`, `status` `not_deployed`.
- Every `address` and `stockToken` must be `null`.
- Constructor arguments, role addresses, feed addresses and bytecode hashes must
  match this runbook.
- Confirm the RPC chain is 84532 and that the command printed "NO DEPLOYMENT
  TRANSACTION WAS SUBMITTED".

Record the proposal hash printed by `pnpm verify:sepolia-deployment` later; the
verifier computes `keccak256` over the exact proposal file bytes and rejects a
mismatch.

Fund only `<ADMIN_ADDRESS>` with Base Sepolia ETH for deployment gas. Check:

```bash
cast balance "$ADMIN_ADDRESS" --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

Observed dry-run estimate for `TestUSDC` was ~982,006 gas; other estimates were
unavailable (unfunded admin / dependent address). Do not proceed if gas funding
is insufficient.

## 3. Deployment order

The order is forced by constructors: `KyroxExchange` takes the `TestUSDC`
address.

| #   | Contract          | Constructor                                |
| --- | ----------------- | ------------------------------------------ |
| 1   | `TestUSDC`        | `(address admin)`                          |
| 2   | `TestStock:tAAPL` | `("Test Apple","tAAPL",18,address admin)`  |
| 3   | `TestStock:tTSLA` | `("Test Tesla","tTSLA",18,address admin)`  |
| 4   | `TestStock:tNVDA` | `("Test NVIDIA","tNVDA",18,address admin)` |
| 5   | `KyroxExchange`   | `(address usdc, address admin)`            |

All commands below prompt the Ledger; verify the sender, chain id 84532,
destination (none for create) and arguments on the device before confirming.
`forge create` sends one deployment transaction per invocation; the runbook
does not script sequential broadcasting.

### 3.1 TestUSDC

```bash
forge create src/TestUSDC.sol:TestUSDC \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --ledger --broadcast \
  --constructor-args "$ADMIN_ADDRESS"
```

Record `<USDC_ADDRESS>` and `<USDC_TX_HASH>`.

- Expected events: none beyond the transaction itself.
- Post-state: `name() == "KYROX Test USD"`, `symbol() == "tUSDC"`,
  `decimals() == 6`, `hasRole(DEFAULT_ADMIN_ROLE, admin) == true`.

Verify:

```bash
cast call <USDC_ADDRESS> "decimals()(uint8)" --rpc-url "$BASE_SEPOLIA_RPC_URL"
cast call <USDC_ADDRESS> "hasRole(bytes32,address)(bool)" \
  0x0000000000000000000000000000000000000000000000000000000000000000 \
  "$ADMIN_ADDRESS" --rpc-url "$BASE_SEPOLIA_RPC_URL"
```

### 3.2 TestStock tokens

Repeat for each asset:

```bash
forge create src/TestStock.sol:TestStock \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --ledger --broadcast \
  --constructor-args "Test Apple" "tAAPL" 18 "$ADMIN_ADDRESS"
```

Record `<TAAPL_ADDRESS>`, `<TTSLA_ADDRESS>`, `<TNVDA_ADDRESS>` and their
transaction hashes.

- Expected events: none.
- Post-state per token: expected name/symbol, `decimals() == 18`,
  `hasRole(DEFAULT_ADMIN_ROLE, admin) == true`.
- Verify with `cast call` for `name()`, `symbol()`, `decimals()` and `hasRole`.

### 3.3 KyroxExchange

```bash
forge create src/KyroxExchange.sol:KyroxExchange \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --ledger --broadcast \
  --constructor-args "<USDC_ADDRESS>" "$ADMIN_ADDRESS"
```

Record `<EXCHANGE_ADDRESS>` and `<EXCHANGE_TX_HASH>`.

- Constructor reverts if the settlement token is not 6-decimal, so a successful
  deployment already proves `USDC.decimals() == 6`.
- Post-state: `usdc() == <USDC_ADDRESS>`, `paused() == false`,
  `hasRole(DEFAULT_ADMIN_ROLE, admin) == true`.
- Verify with `cast call` for `usdc()(address)`, `paused()(bool)` and `hasRole`.

## 4. Post-deployment configuration

Role hashes are stable constants; compute them independently:

```bash
cast keccak "KYROX_EXCHANGE_ROLE"
cast keccak "KYROX_PRICE_UPDATER_ROLE"
cast keccak "KYROX_PAUSER_ROLE"
```

### 4.1 Exchange permission on TestUSDC

```bash
cast send <USDC_ADDRESS> "grantRole(bytes32,address)" \
  <EXCHANGE_ROLE_HASH> "<EXCHANGE_ADDRESS>" \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --ledger
```

Expected event: `RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)`.
Post-state: `hasRole(EXCHANGE_ROLE, exchange) == true`.

### 4.2 Exchange permission on each TestStock

Repeat for all three tokens:

```bash
cast send <STOCK_ADDRESS> "grantRole(bytes32,address)" \
  <EXCHANGE_ROLE_HASH> "<EXCHANGE_ADDRESS>" \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --ledger
```

### 4.3 Exchange operational roles

```bash
cast send <EXCHANGE_ADDRESS> "grantRole(bytes32,address)" \
  <PRICE_UPDATER_ROLE_HASH> "$PRICE_UPDATER_ADDRESS" \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --ledger

cast send <EXCHANGE_ADDRESS> "grantRole(bytes32,address)" \
  <PAUSER_ROLE_HASH> "$PAUSER_ADDRESS" \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --ledger
```

Expected: two `RoleGranted` events; `hasRole` true for each.

### 4.4 Asset listing, bounds and mandatory deviation guard

For each token, first list it, then set the **operator-approved non-zero**
deviation guard:

```bash
cast send <EXCHANGE_ADDRESS> "listAsset(address,uint32,uint256,uint256)" \
  <STOCK_ADDRESS> 3600 1 1000000000000 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --ledger

cast send <EXCHANGE_ADDRESS> "setPriceBounds(address,uint256,uint256,uint16)" \
  <STOCK_ADDRESS> 1 1000000000000 <APPROVED_DEVIATION_BPS> \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --ledger
```

A zero deviation is rejected by the dry-run proposal. The actual tolerance is a
founder decision and must match `SEPOLIA_DEVIATION_BPS`.

Arguments: `maxSourceAgeSeconds = 3600`, `minPrice = 1`, `maxPrice = 1e12`
(1,000,000 USDC per whole token). These values must match the approved proposal.

Expected event:
`AssetListed(address indexed stockToken, uint8 stockDecimals, uint32 maxSourceAgeSeconds, uint256 minPrice, uint256 maxPrice)`.

Post-state: `assetSettings(token)` returns `listed=true`, `stockDecimals=18`,
`maxSourceAgeSeconds=3600`, `maxPriceDeviationBps=<APPROVED_BPS>`, bounds
`1`/`1000000000000`.

## 4a. Source verification

For each deployed address:

```bash
forge verify-contract <ADDRESS> src/TestUSDC.sol:TestUSDC \
  --chain 84532 --verifier etherscan --etherscan-api-key "$BASESCAN_API_KEY" \
  --constructor-args $(cast abi-encode "constructor(address)" "$ADMIN_ADDRESS")
```

Use `TestStock` with `(string,string,uint8,address)` and `KyroxExchange` with
`(address,address)` for the other contracts. None of these commands sign.

## 5. Independent on-chain verification

Create `deployments/base-sepolia.deployment-evidence.json` (git-ignored) with
the real hashes and addresses only:

```json
{
  "environment": "base-sepolia",
  "chainId": 84532,
  "proposalHash": "<PROPOSAL_HASH_PRINTED_BY_VERIFIER>",
  "roles": {
    "admin": "<ADMIN_ADDRESS>",
    "priceUpdater": "<PRICE_UPDATER_ADDRESS>",
    "pauser": "<PAUSER_ADDRESS>",
    "deployer": "<DEPLOYER_ADDRESS>"
  },
  "contracts": {
    "TestUSDC": { "address": "<USDC_ADDRESS>", "transactionHash": "<USDC_TX_HASH>" },
    "TestStock:tAAPL": { "address": "<TAAPL_ADDRESS>", "transactionHash": "<TAAPL_TX_HASH>" },
    "TestStock:tTSLA": { "address": "<TTSLA_ADDRESS>", "transactionHash": "<TTSLA_TX_HASH>" },
    "TestStock:tNVDA": { "address": "<TNVDA_ADDRESS>", "transactionHash": "<TNVDA_TX_HASH>" },
    "KyroxExchange": { "address": "<EXCHANGE_ADDRESS>", "transactionHash": "<EXCHANGE_TX_HASH>" }
  }
}
```

Run:

```bash
BASE_SEPOLIA_RPC_URL="$BASE_SEPOLIA_RPC_URL" \
BASE_SEPOLIA_RPC_URL_SECONDARY="$BASE_SEPOLIA_RPC_URL_SECONDARY" \
DEPLOYMENT_CONFIRMATIONS=12 \
pnpm verify:sepolia-deployment
```

The verifier is read-only and checks: chain 84532, receipt success, receipt
contract address, non-zero address, bytecode presence, runtime bytecode against
the compiled artifact with immutable references masked, constructor arguments,
token metadata, admin roles, exchange roles, settlement token, paused state, and
per-asset listing/freshness/bounds. Any mismatch aborts without writing a record.

Only on full success it writes
`deployments/base-sepolia.verified-pending.json` with
`status: verified_pending_activation`. That file is still not a live manifest.

## 6. Manifest activation

`deployments/base-sepolia.json` remains unpopulated until an operator explicitly
runs:

```bash
BASE_SEPOLIA_RPC_URL="$BASE_SEPOLIA_RPC_URL" \
BASE_SEPOLIA_RPC_URL_SECONDARY="$BASE_SEPOLIA_RPC_URL_SECONDARY" \
DEPLOYMENT_CONFIRMATIONS=12 \
pnpm activate:sepolia-manifest --confirm
```

Activation re-fetches every deployment receipt, requires the recorded block
hash to still be canonical, the address to still have code, and the confirmation
threshold to be met.

- Activation requires the pending record's proposal hash to match the reviewed
  proposal.
- An existing deployed manifest is never overwritten silently: activation fails
  unless `--overwrite` is passed, and a timestamped `.bak.*` copy is written
  first.
- The promoted manifest must pass the production loader (`environment:
base-sepolia`, `status: deployed`, non-zero addresses).
- Review the diff and commit only after approval. Do not run activation in this
  task.

## 7. First price publication (future; do not execute now)

1. Run ingestion against the production database:
   `BASE_MAINNET_RPC_URL=... DATABASE_URL=... PRICE_ALLOWED_TICKERS=tAAPL,tTSLA,tNVDA pnpm price:ingest`.
2. Confirm the report shows the sequencer healthy and at least one new round.
3. Inspect the stored observation:
   `SELECT asset_symbol, source_round_id, source_updated_at, observed_at, status FROM price_observations ORDER BY id DESC;`
4. The ingestion report includes the prepared publication, calldata and hash; or
   load the publication row from `price_publications`.
5. Review chain 84532, exchange, calldata, price, round, source timestamp, feed
   and simulated flag.
6. Sign externally, e.g.:

   ```bash
   cast send <EXCHANGE_ADDRESS> \
     "setPrice(address,uint256,uint256,uint256,uint256,address,bool)" \
     <STOCK_ADDRESS> <PRICE> <ROUND_ID> <SOURCE_UPDATED_AT> 8453 \
     <FEED_ADDRESS> <SIMULATED> \
     --rpc-url "$BASE_SEPOLIA_RPC_URL" --ledger
   ```

   Do not substitute a different round or timestamp at signing time.

7. Record `<TX_HASH>`.
8. Run:

   ```bash
   BASE_SEPOLIA_RPC_URL=... DATABASE_URL=... \
   pnpm price:verify-publication --asset tAAPL --round <ROUND_ID> --tx-hash <TX_HASH>
   ```

9. The verifier checks receipt, destination, calldata hash, arguments,
   `PriceSet` event, and `observation(token)`.
10. Wait for the configured confirmation threshold (`VERIFY_CONFIRMATIONS`,
    default 3).
11. Confirm `price_publications.status == 'verified'`.

## 7a. Trade-limit caveat

The 1 / 1,000 / 5,000 tUSDC limits are **off-chain policy only**. Anyone can call
`buy`/`sell` directly on the exchange. No claim may state that these limits are
enforced on-chain. A founder decision is required before external beta.

## 8. Emergency pause and recovery

- Pause: `cast send <EXCHANGE_ADDRESS> "pause()" --ledger` from the pauser.
- Trading then fails closed; prepared intents become unusable.
- Recovery from a bad observation requires pausing, then
  `resetObservation(token)` from the admin while paused, then a fresh valid
  publication, then `unpause()`.
- Do not renounce `DEFAULT_ADMIN_ROLE`, and do not grant roles to unverified
  addresses.

## 9. Go/no-go checklist

- [ ] Proposal reviewed and hash recorded.
- [ ] Admin, updater and pauser addresses approved and funded where needed.
- [ ] Chain id 84532 confirmed.
- [ ] All five deployments succeeded and are verified on Basescan.
- [ ] Token metadata and admin roles confirmed.
- [ ] Exchange settlement token and roles confirmed.
- [ ] Asset listing/freshness/bounds confirmed.
- [ ] Read-only deployment verification passed.
- [ ] Manifest activation explicitly approved.
- [ ] Pause procedure rehearsed.
- [ ] First publication verified to the confirmation threshold.
