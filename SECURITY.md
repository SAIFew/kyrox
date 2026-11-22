# Security Policy

## Scope & Experimental Testnet Status

**KYROX is an experimental, pre-audit testnet system operating exclusively on Base Sepolia (`chainId: 84532`).**

- **No Mainnet Execution or Real Funds:** No contract is deployed on Base Mainnet or Base Sepolia production manifests (`deployments/base-sepolia.json` is intentionally `"status": "unpopulated"`). Base Mainnet (`chainId: 8453`) is accessed strictly read-only by `services/price` to read public Chainlink reference feeds ([ADR-0006](docs/adr/0006-environment-isolation.md)).
- **No Independent Security Audit:** Neither the Solidity contracts (`packages/contracts/`, `services/mcp-server/contracts/MockStock.sol`), the TypeScript services (`apps/*`, `packages/*`, `services/*`), nor the Python MCP server (`services/mcp-server/`) have undergone an external security audit. Do not use any component of this repository with real funds or mainnet keys.

## Mandatory Non-Custodial & Key-Safety Invariants

1. **Never Submit or Store Private Keys or Seed Phrases:** Never enter, commit, log, or transmit private keys, seed phrases, mnemonics, recovery codes, wallet passwords, or live API secrets in `.env` files, tool arguments, GitHub Issues, Pull Requests, or logs.
2. **External Wallet Signing Only:**
   - Neither the consumer application (`apps/web`, `services/trade-intent`, `services/price`) nor the Python MCP server (`services/mcp-server`) holds private keys, signs transactions, or broadcasts transactions on-chain.
   - All write flows prepare **unsigned** transaction intents or calldata for explicit human review and signing in an external wallet.
3. **Separated Policy Surfaces ([ADR-0011](docs/adr/0011-unified-monorepo-and-policy-surface-separation.md)):**
   - **Consumer Exchange Policy (`packages/core`):** Enforces deterministic USDC notional limits (`1` to `1,000 tUSDC` per trade, `5,000 tUSDC` daily limit), asset allowlisting (`tAAPL`, `tTSLA`, `tNVDA`), oracle freshness (`sourceUpdatedAt` provenance), price bands, and pause checks.
   - **Consumer Assistant Boundary (`services/agent`, [ADR-0005](docs/adr/0005-agent-tool-boundary.md)):** Restricted strictly to read and quote operations; it cannot prepare, sign, or submit transactions.
   - **Developer Python MCP Policy (`services/mcp-server/tools/policy.py`):** Enforces a `50`-token per-transfer ceiling, the `tAAPL`/`tTSLA`/`tNVDA` allowlist, Base Sepolia chain ID (`84532`), `requires_human_approval: true`, and fail-closed redacted JSONL audit logging. See [services/mcp-server/SECURITY.md](services/mcp-server/SECURITY.md) for Python MCP package specifics.
4. **Point-in-Time Simulation & Quote Caveats:** Any EVM dry run (`eth_call`, `eth_estimateGas`) or quote validation reflects state at a single block/timestamp and is not a guarantee that a transaction signed later will succeed.

## Reporting a Vulnerability

If you discover a security vulnerability in any KYROX component:

- **Do not post public exploit details** or sensitive data in a public GitHub Issue or discussion.
- Report the vulnerability privately via **GitHub Private Vulnerability Reporting** (**Security → Advisories → Report a vulnerability** on the repository).
- Include the affected component path (`apps/web`, `packages/contracts`, `packages/core`, `services/price`, `services/trade-intent`, `services/mcp-server`, etc.), exact reproduction steps on Base Sepolia or local Anvil/mock fixtures, and the potential impact.
