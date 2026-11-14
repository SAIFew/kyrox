# KYROX (`kyrox-mcp`)

**Status:** `v0.1` Active Development (`VERIFIED`: Python 3.13 environment, `FastMCP` server, `hello_kyrox`, `get_stock_info`, `list_stocks`, centralized error handling & redacted JSONL audit logging; `IN PROGRESS`: `get_wallet_balances` & Base Sepolia mock ERC-20 deployment; `PLANNED`: portfolio, unsigned transaction prep, simulation & policy gates)
**Target Network:** Base Sepolia Testnet (`chainId: 84532`) · Labelled Mock Token Fixtures (`mock`)
**Runtime Stack:** Python 3.11+ (3.13 x64 baseline) · MCP Python SDK v1 (`FastMCP`, `mcp[cli]>=1.28,<2`) · `web3.py` (`web3>=8.0,<9`)
**License:** Apache-2.0

---

## 1. What KYROX Is

**KYROX** (`kyrox-mcp`) is an open-source, non-custodial Model Context Protocol (MCP) server for AI agents working with tokenized stocks on Base. It is designed to give an AI client structured tools to read tokenized-stock metadata and wallet balances, prepare an **unsigned** transaction intent (`signed: false`), and run pre-execution simulation and policy checks—while leaving transaction review and cryptographic signing strictly to the human user in their own external wallet.

---

## 2. The Problem KYROX Solves

As tokenized equities and real-world assets move on-chain, users want AI agents to help inspect instruments, analyze portfolio exposure, and draft transactions. However, connecting an LLM agent to on-chain financial workflows introduces three major failure modes:

1. **Custody & Key-Exposure Risk:** Giving an AI agent raw private keys or autonomous signing authority creates an unacceptable risk of prompt injection, hallucinated parameters, or unauthorized fund movement.
2. **Unverified Reference Data:** Agents frequently confuse mock fixtures, stale off-hours reference values, or total-return trackers with live executable share prices, or falsely assume a `1:1` token-to-share ratio without checking contract decimals and corporate-action multipliers.
3. **Unchecked Transaction Construction:** Without deterministic server-side validation, an agent can target the wrong chain ID, interact with an unverified contract address, or suffer floating-point rounding errors when converting human-readable amounts into base units.

KYROX addresses these risks by enforcing a strict **Read $\rightarrow$ Prepare $\rightarrow$ Simulate/Check $\rightarrow$ Human Signs Externally** boundary.

---

## 3. Why MCP Is Useful for AI Agents in Finance

The **Model Context Protocol (MCP)** provides a standardized JSON-RPC interface over `stdio` between an AI host (such as MCP Inspector or Claude Desktop) and domain-specific tool servers:

- **Deterministic Boundary Validation:** Instead of trusting an LLM to format raw RPC payloads or ABI calldata in free text, MCP tools validate schemas, checksummed EVM addresses, chain IDs, and `Decimal` quantities inside the Python server before any RPC call is made.
- **Explicit Provenance Envelopes:** Every tool response can return structured metadata—environment label (`mock` vs. `base-sepolia`), data source, observation timestamp, staleness flag, and token decimals—so the agent and user can see the exact provenance of every number.
- **Process & Credential Isolation:** The MCP server runs in an isolated local environment with read-only public RPC configuration, while private keys remain completely outside the server and model context.

---

## 4. High-Level System Architecture (`v0.1`)

```text
AI Host / MCP Client (MCP Inspector / Claude Desktop)
        |
        | MCP stdio transport (JSON-RPC on stdout; diagnostics on stderr)
        v
KYROX Python MCP Server (FastMCP)  [VERIFIED]
        |
        +--> Stock Data Adapter ------> Labelled mock fixtures (data/stocks.json)  [VERIFIED]
        +--> Wallet Reader -----------> Base Sepolia RPC (ERC-20 read calls, chainId 84532)  [IN PROGRESS]
        +--> Portfolio Calculator ----> Token balances + qualified reference values (Decimal / base units)  [PLANNED]
        +--> Transaction Builder -----> Unsigned transaction payload only (signed: false)  [PLANNED]
        +--> Simulator ---------------> eth_call + gas estimate + policy checks on exact intent  [PLANNED]
        +--> Audit Logger & Errors ---> Redacted JSONL call logs & error classification  [VERIFIED]
        +--> Transaction Policy Gate -> Allowlist & per-tx bounds  [PLANNED]

Human reviews and signs outside KYROX in their own external wallet.
KYROX v0.1 never receives private keys, never signs, and never broadcasts.
```

---

## 5. Current Implementation Status (`VERIFIED`, `IN PROGRESS`, `PLANNED`)

KYROX follows a strict evidence-first policy: **every component is labelled by its actual implementation and verification state in this repository.**

| Component | Status | Notes |
|---|---|---|
| Python 3.11+ / 3.13 virtual environment & dependency lock | `VERIFIED` | [requirements.txt](requirements.txt) (cross-platform) and [requirements-lock.txt](requirements-lock.txt) (73 pinned packages). |
| Environment & security hygiene smoke tests | `VERIFIED` | [tests/test_environment_smoke.py](tests/test_environment_smoke.py) (`4 passed` via `pytest`). |
| Public configuration template & ignore rules | `VERIFIED` | [.env.example](.env.example) (placeholders only) and [.gitignore](.gitignore). |
| Package directory scaffolds (`tools/`, `tests/`, `data/`) | `VERIFIED` | [tools/__init__.py](tools/__init__.py), [tests/__init__.py](tests/__init__.py), [data/.gitkeep](data/.gitkeep). |
| FastMCP server entrypoint (`server.py`) & `hello_kyrox` tool | `VERIFIED` | [server.py](server.py) (`FastMCP("KYROX")` over `stdio`). |
| Stock catalogue tools (`get_stock_info`, `list_stocks`) | `VERIFIED` | [tools/stocks.py](tools/stocks.py), [data/stocks.json](data/stocks.json), and [tests/test_stocks.py](tests/test_stocks.py) (`37 passed` via `pytest`, including schema, finite-number, duplicate-ticker, and cache invalidation checks). |
| Mock ERC-20 stock contract (`contracts/MockStock.sol`) | `IMPLEMENTED` | [contracts/MockStock.sol](contracts/MockStock.sol) (OpenZeppelin ERC-20, 18 decimals, mints `1,000` tokens to deployer). |
| Base Sepolia wallet balance reader (`get_wallet_balances`) | `IN PROGRESS` | [tools/wallet.py](tools/wallet.py) and [tests/test_wallet.py](tests/test_wallet.py) (`49 passed` unit/MCP tests including zero-address, EIP-55 checksum, RPC config/timeout, and contract call checks; awaiting live Base Sepolia `tAAPL`, `tTSLA`, `tNVDA` contract addresses in `data/stocks.json` for on-chain verification). |
| Structured JSONL audit logging & centralized error handling (`tools/log.py`, `tools/errors.py`) | `VERIFIED` | [tools/log.py](tools/log.py), [tools/errors.py](tools/errors.py), and [tests/test_logging_and_errors.py](tests/test_logging_and_errors.py) (`14 passed` covering UTC JSONL audit logs, recursive secret redaction, size-based log rotation, concurrency, and retryable vs. non-retryable error classification). |
| Portfolio, unsigned transaction builder, simulator & policy engine | `PLANNED` | Specified below for upcoming `v0.1` milestones. |

---

## 6. The Six MCP Tools (`v0.1` Scope)

All `v0.1` demonstrations operate exclusively on **Base Sepolia testnet (`chainId: 84532`)** and clearly labelled **mock ERC-20 stock tokens**:

| Tool | Category | Status | Behavior |
|---|---|---|---|
| `get_stock_info(ticker)` | Read-only | `VERIFIED` | Return mock tokenized-stock record (`ticker`, `stock`, `reference_value`, `token_address`) for a case-insensitive ticker lookup. |
| `list_stocks()` | Read-only | `VERIFIED` | Return all configured stock summaries (`ticker`, `name`, `reference_value`) from `data/stocks.json` in source order. |
| `get_wallet_balances(wallet)` | Read-only | `IN PROGRESS` | Validate a public EVM address, verify Base Sepolia (`chainId: 84532`), read `balanceOf(wallet)` and `decimals()` on configured ERC-20 contracts, and return non-zero human-readable balances. Code & 36 unit tests complete; awaiting live testnet contract deployment verification. |
| `get_portfolio(wallet)` | Read-only | `PLANNED` | Combine token balances with explicitly qualified reference values using integer base units and `Decimal`. |
| `prepare_transaction(...)` | Unsigned Intent | `PLANNED` | Build an **unsigned** transaction dictionary (`signed: false`) bound to chain ID, sender, allowlisted token contract, recipient, amount, and calldata. |
| `simulate_transaction(...)` | Dry-Run & Policy | `PLANNED` | Validate policy rules and run `eth_call` / gas estimation against the exact prepared transaction intent, reporting simulation caveats. |

*(A `hello_kyrox(name)` connectivity tool is also `VERIFIED` in `server.py`.)*

---

## 7. Technology Stack

- **Language & Runtime:** Python 3.11+ (verified on **Python 3.13.7 x64**)
- **MCP Framework:** Official MCP Python SDK v1 compatibility line (`mcp[cli]>=1.28,<2`, `FastMCP`)
- **Blockchain / EVM Client:** `web3.py` (`web3>=8.0,<9`) targeting Base Sepolia (`chainId: 84532`)
- **HTTP & Configuration:** `requests` (`>=2.32,<3`), `python-dotenv` (`>=1.0,<2`)
- **Testing:** `pytest` (`>=8.0,<10`)
- **Optional Developer Tooling:** Node.js LTS & `npm` / `npx` (used only when launching MCP Inspector UI via `mcp dev`)

---

## 8. Installation & Local Verification

### Prerequisites
- **Python 3.11+** (Python 3.13 recommended)
- **Git**
- **Node.js LTS & npm** *(optional — required only for the browser-based MCP Inspector UI)*

### Windows (PowerShell)
```powershell
# 1. Create and activate a project-local virtual environment
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1

# 2. Install cross-platform dependencies (or use requirements-lock.txt for exact pinned versions)
python -m pip install -r requirements.txt
python -m pip check

# 3. Copy placeholder configuration (never put private keys or secrets in .env)
Copy-Item .env.example .env

# 4. Run the test suite
python -m pytest -v
```

### macOS & Linux (`bash` / `zsh`)
```bash
# 1. Create and activate a project-local virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 2. Install cross-platform dependencies (or use requirements-lock.txt for exact pinned versions)
python -m pip install -r requirements.txt
python -m pip check

# 3. Copy placeholder configuration (never put private keys or secrets in .env)
cp .env.example .env

# 4. Run the test suite
python -m pytest -v
```

---

## 9. Security Principles

Please read [SECURITY.md](SECURITY.md) before using or contributing to KYROX. Core invariants include:

- **No Private Keys or Seed Phrases:** KYROX never asks for, accepts, stores, logs, or transmits private keys, seed phrases, recovery codes, or API secrets.
- **No Signing or Broadcasting:** `v0.1` contains zero transaction-signing or transaction-broadcasting code paths. Every prepared transaction is returned unsigned (`signed: false`) for external human wallet review.
- **Policy Verdict $\neq$ Human Approval:** Passing a server-side policy check or `eth_call` dry run only means the proposed parameters passed automated pre-checks at a point in time; it is not a signature, a guarantee of future on-chain execution, or a substitute for human wallet verification.
- **Exact Financial Arithmetic:** Token quantities and valuations must use integer base units and Python `Decimal`—never binary floating-point numbers.
- **Untrusted Input Validation:** All LLM-supplied tool arguments (tickers, EVM addresses, chain IDs, amounts) and external RPC/API responses are treated as untrusted input and validated at the server boundary.
- **Clean `stdio` Protocol Output:** Server diagnostics and structured logs belong on `stderr` or in local log files (ignored by Git) so MCP `stdio` JSON-RPC frames remain uncorrupted.

---

## 10. Base Sepolia & Mock-Data Limitations

- **Testnet & Mock Fixtures Only:** KYROX `v0.1` is restricted to **Base Sepolia testnet (`chainId: 84532`)** and local mock stock fixtures (`mock`). It does not connect to mainnet execution venues or trade real equities.
- **Mock ERC-20 Tokens $\neq$ Regulated Securities:** Testnet mock tokens do not model regulated issuance, corporate actions, dividend/split multipliers, off-hours market halts, or live order-book liquidity.
- **Reference Values Are Not Live Quotes:** Any `reference_value` in mock fixtures is static test data for development and must never be treated as a live market price or executable quote.
- **Point-in-Time Simulation Caveat:** An `eth_call` simulation or gas estimate reflects RPC state at a single block height and does not guarantee that a transaction signed later will succeed on-chain.
- **Not Audited / Not Financial Advice:** KYROX is an experimental open-source technical prototype and has not undergone an independent security audit. Nothing in this repository constitutes financial, investment, legal, or tax advice. KYROX has **no token**, no token sale, and no airdrop or yield program.

---

## 11. License

Licensed under the **Apache License, Version 2.0** (`Apache-2.0`). See the [LICENSE](LICENSE) file for the full license text.
