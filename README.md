# KYROX (`kyrox-mcp`)

**Status:** `v0.1` Active Development (`VERIFIED`: Python 3.13 environment, `FastMCP` server, `hello_kyrox`, `get_stock_info`, `list_stocks`, centralized error handling, redacted JSONL audit logging, standalone transaction safety policy module `tools/policy.py` & STDIO protocol framing; `IN PROGRESS`: `get_wallet_balances`, `get_portfolio`, `prepare_transaction` & `simulate_transaction` — code & `394` offline/MCP/mock-provider tests verified, awaiting live Base Sepolia `MockStock.sol` deployment)
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
        +--> Stock Data Adapter ------> Labelled mock fixtures (data/stocks.json / KYROX_STOCKS_FILE)  [VERIFIED]
        +--> Wallet Reader -----------> Base Sepolia RPC (ERC-20 read calls, chainId 84532)  [IN PROGRESS]
        +--> Portfolio Calculator ----> Token balances + qualified reference values (100-digit Decimal)  [IN PROGRESS]
        +--> Transaction Builder -----> Unsigned transaction payload only (signed: false)  [IN PROGRESS]
        +--> Simulator ---------------> eth_call + gas estimate + policy checks on exact intent  [IN PROGRESS]
        +--> Audit Logger & Errors ---> Redacted JSONL call logs & error classification  [VERIFIED]
        +--> Transaction Policy Gate -> 50-token max, ticker allowlist & human approval (tools/policy.py)  [VERIFIED]

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
| Base Sepolia wallet balance & portfolio reader (`get_wallet_balances`, `get_portfolio`) | `IN PROGRESS` | [tools/wallet.py](tools/wallet.py), [tests/test_wallet.py](tests/test_wallet.py), [tests/test_portfolio.py](tests/test_portfolio.py), and [tests/test_stdio.py](tests/test_stdio.py) (`107 passed` wallet/portfolio/STDIO tests covering zero-address, EIP-55 checksum, `uint256` bounds, contract vs. dataset decimal consistency, 100-digit `Decimal` valuation, currency-mismatch protection, and explicit `unpriced_holdings`; packaged `data/stocks.json` remains unchanged with blank `token_address` fields while live Base Sepolia `tAAPL`, `tTSLA`, `tNVDA` addresses are loaded locally via `KYROX_STOCKS_FILE`). |
| Structured JSONL audit logging & centralized error handling (`tools/log.py`, `tools/errors.py`) | `VERIFIED` | [tools/log.py](tools/log.py), [tools/errors.py](tools/errors.py), and [tests/test_logging_and_errors.py](tests/test_logging_and_errors.py) (`14 passed` covering UTC JSONL audit logs, recursive secret redaction, size-based log rotation, concurrency, and retryable vs. non-retryable error classification). |
| Unsigned ERC-20 transaction builder & EVM simulator (`prepare_transaction`, `simulate_transaction`, `tools/tx.py`) | `IN PROGRESS` | [tools/tx.py](tools/tx.py) and [tests/test_tx.py](tests/test_tx.py) (`146 passed` unit, security, serialization, simulation, and FastMCP tests using deterministic mock-provider and transport-level JSON-RPC fixtures; builds unsigned `transfer(to, amount_base_units)` intents with `signed: false`, SHA-256 `intent_hash`, expiration window, policy checks, and dry-runs execution via `eth_call` + `eth_estimateGas` pinned to a single canonical Base Sepolia block snapshot; awaiting live Base Sepolia `MockStock.sol` deployment). |
| Transaction safety policy module (`tools/policy.py`) | `VERIFIED` | [tools/policy.py](tools/policy.py) and [tests/test_policy.py](tests/test_policy.py) (`86 passed` policy unit, integration, audit, and security regression tests; enforces the `50`-token default per-transaction maximum, approved ticker allowlist `tAAPL` / `tTSLA` / `tNVDA`, positive finite `Decimal` amounts, token-decimal precision, `requires_human_approval: true`, independent pre-RPC enforcement in both `prepare_transaction` and `simulate_transaction`, and fail-closed JSONL audit logging of every allowed and denied policy decision). |

---

## 6. The Six MCP Tools (`v0.1` Scope)

All `v0.1` demonstrations operate exclusively on **Base Sepolia testnet (`chainId: 84532`)** and clearly labelled **mock ERC-20 stock tokens**:

| Tool | Category | Status | Behavior |
|---|---|---|---|
| `get_stock_info(ticker)` | Read-only | `VERIFIED` | Return mock tokenized-stock record (`ticker`, `stock`, `reference_value`, `token_address`) for a case-insensitive ticker lookup. |
| `list_stocks()` | Read-only | `VERIFIED` | Return all configured stock summaries (`ticker`, `name`, `reference_value`) from `data/stocks.json` in source order. |
| `get_wallet_balances(wallet)` | Read-only | `IN PROGRESS` | Validate a public EVM address, verify Base Sepolia (`chainId: 84532`), read `balanceOf(wallet)` and `decimals()` on configured ERC-20 contracts, and return non-zero human-readable balances. Code & 49 unit tests complete; awaiting live testnet contract deployment verification. |
| `get_portfolio(wallet)` | Read-only | `IN PROGRESS` | Combine Base Sepolia ERC-20 token balances with qualified reference values using 100-digit `Decimal` arithmetic, enforce single-currency aggregation, flag `unpriced_holdings`, and return structured `holdings`, `total_value`, and explicit `warnings`. Code & 56 unit/MCP tests complete; awaiting live testnet contract deployment verification. |
| `prepare_transaction(from_wallet, ticker, to, amount)` | Unsigned Intent | `IN PROGRESS` | Validate sender/recipient addresses, Base Sepolia (`chainId: 84532`), configured token contract, and contract `decimals()`; convert human token amount to exact integer base units via `Decimal`; enforce policy bounds; and return an **unsigned** ERC-20 `transfer(to, amount_base_units)` intent (`signed: false`, `intent_hash`, `expires_at`, `unsigned_tx`). Code & mock-provider/MCP tests complete; awaiting live testnet contract deployment verification. |
| `simulate_transaction(from_wallet, ticker, to, amount)` | Dry-Run & Policy | `IN PROGRESS` | Reuse `prepare_transaction` and policy checks, verify the unsigned transaction intent (`intent_hash`, `expires_at`, `chainId: 84532`), capture a single canonical block number (`eth_blockNumber`), execute `eth_call` (decoding the ERC-20 `bool` return value) and `eth_estimateGas` (in gas units) against that pinned block snapshot using an allowlisted EIP-1474 call object, and report `would_succeed`, `estimated_gas`, `block_number`, or sanitized revert/error classifications (`signed: false`, `broadcast: false`). Code & 146 `test_tx.py` tests complete; awaiting live testnet contract deployment verification. |

*(A `hello_kyrox(name)` connectivity tool is also `VERIFIED` in `server.py`.)*

### How `prepare_transaction` Works (`tools/tx.py`)

- **Input Parameters:**
  - `from_wallet` (`str`): Public EIP-55 checksummed or hex sender wallet address on Base Sepolia.
  - `ticker` (`str`): Approved tokenized-stock ticker symbol from the configured stock catalogue (e.g., `tAAPL`, `tTSLA`, `tNVDA`).
  - `to` (`str`): Public EIP-55 checksummed or hex recipient wallet address on Base Sepolia.
  - `amount` (`int | float | str`): Positive finite token quantity to transfer.
- **Exact ERC-20 Amount Conversion:** `prepare_transaction` reads `decimals()` from the verified token contract (and cross-checks dataset `decimals` when configured; it never blindly assumes 18 decimals). User-facing token amounts are validated via `Decimal` (rejecting booleans, `NaN`, `Infinity`, `<= 0`, and fractional precision exceeding token `decimals`) and converted into exact integer base units (`amount * 10**decimals`) with zero binary floating-point rounding or truncation.
- **Contract Target vs. Recipient Separation:** In the returned `unsigned_tx` envelope, `unsigned_tx["to"]` always points to the **ERC-20 token contract address**, while the recipient wallet (`to`) and `amount_base_units` are ABI-encoded inside `unsigned_tx["data"]` (`transfer(address,uint256)` selector `0xa9059cbb`).
- **Pending Nonce Snapshot:** The sender `nonce` is queried using `eth_getTransactionCount(from_wallet, "pending")`. A prepared nonce is a point-in-time snapshot and is not reserved on-chain.
- **Unsigned & Non-Custodial (`signed: false`):** KYROX never accepts, stores, or accesses private keys or seed phrases, and contains no `sign_transaction` or `send_raw_transaction` code paths. Every prepared intent returns `signed: false` and `broadcast: false` so the human user can inspect, simulate, and sign externally in their own wallet on **Base Sepolia (`chainId: 84532` / `0x14a34`)** only.
- **Missing Deployment Configuration & Mock Provider Testing:** Packaged `data/stocks.json` keeps `token_address: ""` in version control until live Base Sepolia `MockStock.sol` contracts are deployed and supplied via `KYROX_STOCKS_FILE`. When `token_address` is blank, `prepare_transaction` safely rejects with `MISSING_CONFIGURATION`. All positive automated tests in `tests/test_tx.py` use a deterministic mocked Web3 provider fixture (`MOCK PROVIDER · TEST FIXTURE`) rather than live on-chain transactions.

### How `simulate_transaction` Works (`tools/tx.py`)

- **Shared Preparation & Policy Gate Before RPC:** `simulate_transaction(from_wallet, ticker, to, amount)` reuses `prepare_transaction` and `verify_prepared_transaction_intent` rather than duplicating transfer construction. Policy limits (`KYROX_MAX_TX_AMOUNT`, `DEFAULT_MAX_TOKEN_AMOUNT`, `KYROX_APPROVED_TICKERS`, `KYROX_ALLOWED_RECIPIENTS`, and token-contract self-transfer prevention) execute **before** any simulation RPC call. Requests exceeding the configured policy limit are blocked immediately with `POLICY_REJECTED`.
- **`eth_call` vs. `eth_estimateGas` on Base Sepolia (`chainId: 84532`, Pinned Canonical Block Snapshot):**
  - **Single Canonical Block Snapshot:** After verifying Base Sepolia (`chainId == 84532`) and contract bytecode, KYROX queries `eth_blockNumber` once, validates it as a non-negative integer, and passes that exact block number to both `eth_call` and `eth_estimateGas` so the two RPC calls cannot evaluate different block heights.
  - **Allowlisted EIP-1474 Call Object (`build_simulation_call_object`):** Rather than forwarding internal intent metadata or transaction-signing fields (`chainId`, `nonce`, `intent_hash`, `expires_at`, `signed`, `broadcast`), KYROX constructs a dedicated execution-call dictionary containing only the allowlisted EIP-1474 fields (`from`, `to`, `data`, `value: 0`).
  - **`eth_call` (Execution Dry-Run):** Executes the exact prepared message call (`from: from_wallet`, `to: token_address`, `data: calldata`, `value: 0`) against the captured canonical block number without creating, signing, or broadcasting a transaction. KYROX ABI-decodes the 32-byte `bool` return word from `transfer(address,uint256)` so an explicit `false` return (`0x00...00`) is classified as a failed simulation (`would_succeed: false`, `ERC20_TRANSFER_FALSE`) rather than a false positive.
  - **`eth_estimateGas` (Gas Unit Estimation):** Only after `eth_call` succeeds and returns `true`, KYROX calls `eth_estimateGas` with the identical execution-call dictionary and pinned block number. `estimated_gas` is returned strictly in **gas units** (`gas_units: "gas"`), never as an ETH or currency fee, and KYROX never invents a fallback gas number if estimation fails.
- **Error Taxonomy & Provider Outage Separation:** KYROX distinguishes (1) successful simulation (`would_succeed: true`), (2) insufficient token balance reverts (`INSUFFICIENT_TOKEN_BALANCE`, including OpenZeppelin v5 `ERC20InsufficientBalance` selector `0xe450d38c` and v4 `transfer amount exceeds balance`), (3) other contract-level reverts (`SIMULATION_REVERTED`), (4) ERC-20 `false` returns (`ERC20_TRANSFER_FALSE`), (5) policy rejections (`POLICY_REJECTED`), (6) expired/tampered intents (`INTENT_EXPIRED`, `INTENT_TAMPERED`), (7) address/amount/chain/configuration errors, and (8) RPC timeouts (`RPC_TIMEOUT`), connection failures (`RPC_CONNECTION_FAILED`), and malformed provider responses (`MALFORMED_PROVIDER_RESPONSE`). An RPC outage is never misrepresented as an insufficient-balance revert.
- **Why Simulation Does Not Guarantee Later Execution:** Both `eth_call` and `eth_estimateGas` evaluate blockchain state at a single point in time (`"latest"`). Between simulation and external human wallet signing, balances, allowances, contract pause states, nonces, or gas conditions can change. Human review and external wallet verification remain mandatory.

### How the Transaction Safety Policy Works (`tools/policy.py`)

- **50-Token Default Transaction Maximum:** `DEFAULT_MAX_TOKEN_AMOUNT` is `50` tokens per transaction (`amount <= 50` inclusive boundary: `10`, `49`, and `50` are allowed by the amount policy; `50.01` and `100` are denied with `POLICY_REJECTED`). Operators can tighten the limit below `50` via `KYROX_MAX_TOKEN_AMOUNT` or `KYROX_MAX_TX_AMOUNT`, while values above the `50`-token safety ceiling (`HARD_MAX_TOKEN_AMOUNT = 50`) are rejected as `INVALID_CONFIGURATION`.
- **Three Approved Tickers (`tAAPL`, `tTSLA`, `tNVDA`):** Only `tAAPL`, `tTSLA`, and `tNVDA` are permitted by the canonical ticker allowlist (`CANONICAL_APPROVED_TICKERS`). Unknown tickers (and arbitrary extra entries injected into a custom dataset file or `KYROX_APPROVED_TICKERS`) are rejected before any RPC call.
- **Strictly Positive, Finite `Decimal` Amounts & Token Precision:** Zero, negative values, `NaN`, `+Infinity`, `-Infinity`, booleans (`True`/`False`), non-numeric strings, and fractional amounts exceeding the token's supported decimal precision are deterministically rejected using `Decimal` arithmetic (never binary floating-point conversion).
- **Mandatory Human Approval (`requires_human_approval = True`):** Every policy decision and transaction tool response—whether allowed or denied—retains `requires_human_approval: true`, `signed: false`, and `broadcast: false`. Passing the policy check is **not** human approval and **not** transaction execution authorization; any attempt to pass override flags (`requires_human_approval=False` or `human_approved=True`) is rejected.
- **Independent Enforcement in Both Transaction Tools:** Both `prepare_transaction` and `simulate_transaction` independently invoke the central policy gate (`_enforce_pre_rpc_transaction_policy` / `evaluate_transaction_policy`) before any unsigned transaction construction, calldata encoding, `eth_call`, or `eth_estimateGas` execution.
- **Fail-Closed Policy Decision Audit Logging:** Every allowed and denied policy decision is recorded in `logs/audit.jsonl` via `tools/log.py` with structured metadata (`event`, `tool`, `ticker`, `normalized_amount`, `effective_max_amount`, `allowed`, `decision`, `reasons`, `requires_human_approval`, `policy_version`) and recursive secret redaction. If writing to the audit log fails during an allowed transaction or policy decision, KYROX fails closed and rejects the operation.

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

# 4. Run the test suite (394 automated checks)
python -m pytest -v

# 5. Execute a portfolio query (uses KYROX_STOCKS_FILE if set, or data/stocks.json)
python -c "import json; from server import get_portfolio; print(json.dumps(get_portfolio('0x71C7656EC7ab88b098defB751B7401B5f6d8976F'), indent=2))"
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

# 4. Run the test suite (394 automated checks)
python -m pytest -v

# 5. Execute a portfolio query (uses KYROX_STOCKS_FILE if set, or data/stocks.json)
python -c "import json; from server import get_portfolio; print(json.dumps(get_portfolio('0x71C7656EC7ab88b098defB751B7401B5f6d8976F'), indent=2))"
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
