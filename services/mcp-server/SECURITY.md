# Security Policy

## Experimental Testnet Prototype Notice

**KYROX (`kyrox-mcp`) is an experimental, pre-audit open-source prototype.**

- **Scope Limitation (`v0.1`):** Only **Base Sepolia testnet (`chainId: 84532`)** and labelled mock fixture functionality are in scope for this initial release.
- **No Production or Mainnet Safety Claims:** KYROX has not undergone an independent security audit. No production readiness, mainnet safety, or financial guarantees are made. Do not use KYROX with mainnet assets or real funds.

## Mandatory Key & Secret Safety Rules

1. **Never Submit Private Keys or Seed Phrases:** Never enter, commit, paste, or attach private keys, seed phrases, mnemonics, keystore files, recovery codes, passwords, or live API secrets in tool calls, `.env` files, GitHub Issues, Pull Requests, or discussions.
2. **Non-Custodial Boundary:** KYROX `v0.1` is designed strictly for read operations, unsigned transaction preparation (`signed: false`), and dry-run simulation/policy checks. It must never hold private keys, sign transactions, or broadcast transactions on-chain. Simulation (`eth_call` and `eth_estimateGas`) reflects a single point-in-time Base Sepolia block snapshot and does not guarantee future transaction execution.
3. **Transaction Safety Policy (`tools/policy.py`):** Both `prepare_transaction` and `simulate_transaction` independently enforce KYROX's deterministic safety policy before any unsigned transaction calldata construction, `eth_call`, or `eth_estimateGas` RPC call:
   - **Maximum Transaction Amount:** `50` tokens per transaction by default (`<= 50` inclusive boundary; `50.01` and `100` are blocked with `POLICY_REJECTED`; configurable via `KYROX_MAX_TOKEN_AMOUNT` or `KYROX_MAX_TX_AMOUNT` up to the hard `50`-token ceiling).
   - **Approved Ticker Allowlist:** Strictly `tAAPL`, `tNVDA`, `tMSFT`, `tGOOGL`, `tAMZN`, `tTSLA`, `tMETA` (unknown tickers and arbitrary dataset entries cannot expand the allowlist).
   - **Positive, Finite `Decimal` Amounts:** Zero, negative values, `NaN`, `Infinity`, booleans, non-numeric inputs, and amounts exceeding token decimal precision are rejected.
   - **Mandatory Human Approval:** Every policy decision and transaction response retains `requires_human_approval: true`. Passing a policy check is never automatic human approval or execution authorization.
4. **Redacted Audit Logging & Fail-Closed Boundary Validation:** Every allowed and denied policy decision and tool call is recursively scrubbed by `tools/errors.py` and `tools/log.py` before being written to local JSONL audit logs (`logs/audit.jsonl`, ignored by Git) or returned in caller-facing error dictionaries. High-impact transaction and policy operations fail closed if audit logging fails. Zero addresses (`0x0000...0000`), corrupted mixed-case EIP-55 checksums, non-Base-Sepolia chain IDs (only Base Sepolia `84532` is permitted; Base Mainnet `8453` is rejected), out-of-range `uint256` balances/amounts, contract/dataset decimal mismatches, unconfigured or bytecode-empty contracts, tampered/expired transaction intents, ERC-20 `false` transfer returns, malformed RPC provider payloads, and mixed-currency portfolio totals are rejected or guarded at the validation boundary.

## Reporting a Vulnerability

If you discover a security issue in KYROX:

- **Do not post public exploit details** (or any real credentials/keys) in a public GitHub Issue or discussion thread.
- Please disclose the issue privately via **GitHub Private Vulnerability Reporting** (under the repository's **Security $\rightarrow$ Advisories $\rightarrow$ Report a vulnerability** tab) so it can be reviewed and addressed before public disclosure.
- Include the affected file/component, reproduction steps on Base Sepolia or local mock fixtures, and the potential impact.
