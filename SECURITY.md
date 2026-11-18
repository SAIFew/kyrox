# Security Policy

## Experimental Testnet Prototype Notice

**KYROX (`kyrox-mcp`) is an experimental, pre-audit open-source prototype.**

- **Scope Limitation (`v0.1`):** Only **Base Sepolia testnet (`chainId: 84532`)** and labelled mock fixture functionality are in scope for this initial release.
- **No Production or Mainnet Safety Claims:** KYROX has not undergone an independent security audit. No production readiness, mainnet safety, or financial guarantees are made. Do not use KYROX with mainnet assets or real funds.

## Mandatory Key & Secret Safety Rules

1. **Never Submit Private Keys or Seed Phrases:** Never enter, commit, paste, or attach private keys, seed phrases, mnemonics, keystore files, recovery codes, passwords, or live API secrets in tool calls, `.env` files, GitHub Issues, Pull Requests, or discussions.
2. **Non-Custodial Boundary:** KYROX `v0.1` is designed strictly for read operations, unsigned transaction preparation (`signed: false`), and dry-run simulation/policy checks. It must never hold private keys, sign transactions, or broadcast transactions on-chain.
3. **Redacted Audit Logging & Boundary Validation:** Tool arguments, RPC URLs, and exception details are recursively scrubbed by `tools/errors.py` and `tools/log.py` before being written to local JSONL audit logs (`logs/`, ignored by Git) or returned in caller-facing error dictionaries. Zero addresses (`0x0000...0000`), corrupted mixed-case EIP-55 checksums, non-Base-Sepolia chain IDs, out-of-range `uint256` balances/amounts, contract/dataset decimal mismatches, unconfigured or bytecode-empty contracts, tampered/expired transaction intents, ERC-20 `false` transfer returns, malformed RPC provider payloads, and mixed-currency portfolio totals are rejected or guarded at the validation boundary.

## Reporting a Vulnerability

If you discover a security issue in KYROX:

- **Do not post public exploit details** (or any real credentials/keys) in a public GitHub Issue or discussion thread.
- Please disclose the issue privately via **GitHub Private Vulnerability Reporting** (under the repository's **Security $\rightarrow$ Advisories $\rightarrow$ Report a vulnerability** tab) so it can be reviewed and addressed before public disclosure.
- Include the affected file/component, reproduction steps on Base Sepolia or local mock fixtures, and the potential impact.
