# KYROX (`kyrox-mcp`)

**Version:** `0.1.0` (`v0.1` Active Development)
**Verification Status:**
- `VERIFIED`: Python 3.11+ / 3.13 environment, `pyproject.toml` packaging (`kyrox-mcp` console entrypoint), `FastMCP("KYROX")` STDIO server, `hello_kyrox`, `get_stock_info`, `list_stocks`, centralized error handling (`tools/errors.py`), redacted JSONL audit logging (`tools/log.py`), standalone transaction safety policy engine (`tools/policy.py`), and STDIO protocol framing (`394+` offline/MCP/mock-provider automated tests passing)
- `IN PROGRESS`: `get_wallet_balances`, `get_portfolio`, `prepare_transaction` & `simulate_transaction` — implementation and deterministic mock-provider/MCP tests complete; live on-chain token balance and dry-run demonstrations await manual Base Sepolia `MockStock.sol` deployment via `KYROX_STOCKS_FILE`

**Target Network:** Base Sepolia Testnet (`chainId: 84532` / `0x14a34`) · Labelled Mock Token Fixtures (`mock`)
**Runtime Stack:** Python 3.11+ (3.13 x64 baseline) · MCP Python SDK v1 (`FastMCP`, `mcp[cli]>=1.28,<2`) · `web3.py` (`web3>=8.0,<9`)
**License:** Apache-2.0

---

## 1. What KYROX Is

**KYROX** (`kyrox-mcp`) is an open-source, non-custodial Model Context Protocol (MCP) server for AI agents working with tokenized stocks on Base. It gives an MCP-compatible AI client (such as Claude Desktop, Antigravity, or MCP Inspector) structured tools to read tokenized-stock metadata and wallet balances, compute portfolio valuations with explicit provenance warnings, prepare an **unsigned** ERC-20 transaction intent (`signed: false`), and run pre-execution EVM simulations (`eth_call` + `eth_estimateGas`) and deterministic safety policy checks—while leaving transaction review and cryptographic signing strictly to the human user in their own external wallet.

---

## 2. The Problem KYROX Solves

As tokenized equities and real-world assets move on-chain, developers and users want AI agents to inspect instruments, analyze portfolio exposure, and draft transactions. Connecting an LLM agent to on-chain financial workflows introduces three major failure modes:

1. **Custody & Key-Exposure Risk:** Giving an AI agent raw private keys or autonomous signing authority creates an unacceptable risk of prompt injection, hallucinated parameters, or unauthorized fund movement.
2. **Unverified Reference Data:** Agents frequently confuse mock fixtures, stale off-hours reference values, or total-return trackers with live executable share prices, or falsely assume a `1:1` token-to-share ratio without checking contract decimals and corporate-action multipliers.
3. **Unchecked Transaction Construction:** Without deterministic server-side validation, an agent can target the wrong chain ID, interact with an unverified contract address, exceed safe transfer limits, or suffer binary floating-point rounding errors when converting human-readable amounts into integer base units.

KYROX addresses these risks by enforcing a strict **Read $\rightarrow$ Prepare $\rightarrow$ Simulate & Policy Check $\rightarrow$ Human Signs Externally** boundary.

---

## 3. How the MCP Connection Works

The **Model Context Protocol (MCP)** provides a standardized JSON-RPC 2.0 interface over `stdio` between an AI host application and local tool servers:

- **STDIO Framing (`stdin` / `stdout` / `stderr`):** The AI host spawns the KYROX process (`kyrox-mcp` or `python server.py`) and communicates via newline-delimited JSON-RPC messages on `stdin` and `stdout`. All protocol frames use `stdout` exclusively, while structured audit logs go to `logs/audit.jsonl` (with fallback warnings on `stderr` only), guaranteeing zero `stdout` corruption.
- **Deterministic Boundary Validation:** Instead of trusting an LLM to format raw RPC payloads or ABI calldata in free text, KYROX validates Pydantic tool schemas, EIP-55 checksummed EVM addresses, Base Sepolia chain ID (`84532`), approved ticker symbols (`tAAPL`, `tTSLA`, `tNVDA`), and `Decimal` quantities inside the Python server before any RPC call is made.
- **Explicit Provenance Envelopes:** Every tool response returns structured metadata—environment label (`mock` vs. `base-sepolia`), valuation basis (`mock_reference_value`), currency, token decimals, policy verdict, and `requires_human_approval: true`—so both the agent and human user see the exact provenance of every number.
- **Process & Credential Isolation:** The MCP server runs locally with read-only public Base Sepolia RPC configuration, while private keys and seed phrases remain completely outside the server and model context.

---

## 4. Actual Architecture & Supported Network (`v0.1`)

- **Supported Network:** Exclusively **Base Sepolia Testnet (`chainId: 84532` / `0x14a34`)**. Base Mainnet (`8453`) and all other EVM networks are deterministically rejected with `UNSUPPORTED_CHAIN_ID`.
- **Entrypoint & Package Layout:**
  - `server.py` (`main()` / `FastMCP("KYROX")` over `stdio`, installed as the `kyrox-mcp` console script via `pyproject.toml`)
  - `tools/stocks.py` — Stock dataset loader, schema validator, `KYROX_STOCKS_FILE` override & SHA-256/mtime cache
  - `tools/wallet.py` — Base Sepolia RPC connector, EIP-55 address validator, ERC-20 reader (`get_wallet_balances`) & 100-digit `Decimal` portfolio engine (`get_portfolio`)
  - `tools/policy.py` — Standalone transaction safety policy gate (`evaluate_transaction_policy`: 50-token max cap, `tAAPL`/`tTSLA`/`tNVDA` allowlist, `requires_human_approval: true`)
  - `tools/tx.py` — Unsigned ERC-20 `transfer(address,uint256)` intent builder (`prepare_transaction`), SHA-256 `intent_hash` verifier & pinned-block EVM simulator (`simulate_transaction`)
  - `tools/log.py` — Thread-safe, rotating, secret-redacting JSONL audit logger (`@audit_tool_call`, fail-closed on transaction tools)
  - `tools/errors.py` — Centralized `ErrorCode` taxonomy, `KyroxError` hierarchy & recursive secret redaction
  - `data/stocks.json` — Packaged mock stock catalogue (`tAAPL`, `tTSLA`, `tNVDA` with `token_address: ""` in version control)
  - `contracts/MockStock.sol` — Solidity `^0.8.20` OpenZeppelin ERC-20 mock stock contract (18 decimals, mints `1,000` test tokens to deployer)

```text
AI Host / MCP Client (Claude Desktop / Antigravity / MCP Inspector)
        |
        | MCP stdio transport (JSON-RPC 2.0 on stdout; diagnostics on stderr)
        v
KYROX Python MCP Server (FastMCP("KYROX") · server.py / kyrox-mcp)  [VERIFIED]
        |
        +--> Stock Data Adapter ------> Labelled mock fixtures (data/stocks.json / KYROX_STOCKS_FILE)  [VERIFIED]
        +--> Wallet Reader -----------> Base Sepolia RPC (ERC-20 read calls, chainId 84532)  [IN PROGRESS]
        +--> Portfolio Calculator ----> Token balances + qualified reference values (100-digit Decimal)  [IN PROGRESS]
        +--> Transaction Policy Gate -> 50-token max, ticker allowlist & human approval (tools/policy.py)  [VERIFIED]
        +--> Transaction Builder -----> Unsigned transaction payload only (signed: false)  [IN PROGRESS]
        +--> Simulator ---------------> eth_call + gas estimate on pinned canonical block snapshot  [IN PROGRESS]
        +--> Audit Logger & Errors ---> Redacted JSONL call logs (fail-closed) & error taxonomy  [VERIFIED]

Human reviews and signs outside KYROX in their own external wallet.
KYROX never receives private keys, never signs, and never broadcasts.
```

---

## 5. Prerequisites

- **Python 3.11+** (64-bit required; verified on **Python 3.13.7 x64**)
- **Git**
- **Internet access to a Base Sepolia JSON-RPC endpoint** *(optional for offline stock catalogue and policy checks; required only when calling live Base Sepolia RPC reads via `https://sepolia.base.org`)*
- **Node.js LTS & `npm` / `npx`** *(optional — required only if launching the browser-based MCP Inspector UI via `mcp dev`)*

---

## 6. Installation on macOS / Linux (`bash` / `zsh`)

```bash
# 1. Clone the repository and enter the project directory
git clone https://github.com/SAIFew/kyrox-mcp.git
cd kyrox-mcp

# 2. Create and activate an isolated Python 3.11+ virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 3. Install the KYROX package (and optional test/dev dependencies)
python -m pip install .
python -m pip install ".[dev]"
python -m pip check

# (Alternative: install exact pinned versions from requirements-lock.txt)
# python -m pip install -r requirements-lock.txt

# 4. Create a local .env from the safe placeholder template (optional; defaults to https://sepolia.base.org)
cp .env.example .env

# 5. Verify that the installed package and offline tools respond cleanly
python -c "import json; from server import hello_kyrox, list_stocks; print(hello_kyrox('Developer')); print(json.dumps(list_stocks(), indent=2))"
```

---

## 7. Installation on Windows PowerShell

```powershell
# 1. Clone the repository and enter the project directory
git clone https://github.com/SAIFew/kyrox-mcp.git
Set-Location kyrox-mcp

# 2. Create and activate an isolated Python 3.11+ (3.13 recommended) virtual environment
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1

# 3. Install the KYROX package (and optional test/dev dependencies)
python -m pip install .
python -m pip install ".[dev]"
python -m pip check

# (Alternative: install exact pinned versions from requirements-lock.txt)
# python -m pip install -r requirements-lock.txt

# 4. Create a local .env from the safe placeholder template (optional; defaults to https://sepolia.base.org)
Copy-Item .env.example .env

# 5. Verify that the installed package and offline tools respond cleanly
python -c "import json; from server import hello_kyrox, list_stocks; print(hello_kyrox('Developer')); print(json.dumps(list_stocks(), indent=2))"
```

> **Note on Console Entrypoint:** Installing with `python -m pip install .` registers the `kyrox-mcp` console script inside your virtual environment (`.venv/bin/kyrox-mcp` on macOS/Linux, `.venv\Scripts\kyrox-mcp.exe` on Windows) in addition to `python server.py`. Because KYROX uses MCP `stdio` transport, starting `kyrox-mcp` or `python server.py` directly in a terminal will wait silently on `stdin` for JSON-RPC 2.0 frames.

---

## 8. Environment Configuration

Copy [.env.example](.env.example) to `.env` if you want to customize runtime settings. **Never place private keys, seed phrases, mnemonics, or URL-embedded credentials in `.env`.** All environment variables are optional at startup because safe Base Sepolia defaults are built in:

| Variable | Required? | Default | Validation / Purpose |
|---|---|---|---|
| `BASE_RPC_URL` | Optional | `https://sepolia.base.org` | HTTP(S) JSON-RPC endpoint for Base Sepolia (`chainId: 84532`). Whitespace and non-HTTP(S) schemes are rejected. Any endpoint returning a chain ID other than `84532` is rejected with `UNSUPPORTED_CHAIN_ID`. |
| `BASE_RPC_TIMEOUT` | Optional | `10.0` | HTTP RPC request timeout in seconds (`0 < timeout <= 120.0`). |
| `KYROX_STOCKS_FILE` | Optional | `data/stocks.json` | Path to a custom JSON stock dataset (used to supply deployed Base Sepolia `MockStock.sol` contract addresses locally without modifying packaged `data/stocks.json`). |
| `KYROX_MAX_TOKEN_AMOUNT` | Optional | `50` | Maximum allowed token quantity per transaction (`0 < limit <= 50`). Can tighten the limit below `50`, but values `> 50` are rejected with `INVALID_CONFIGURATION`. |
| `KYROX_MAX_TX_AMOUNT` | Optional | `50` | Alias for `KYROX_MAX_TOKEN_AMOUNT` (`0 < limit <= 50`). If both variables are set, they must not conflict. |
| `KYROX_APPROVED_TICKERS` | Optional | `tAAPL,tTSLA,tNVDA` | Comma-separated active ticker subset. Must be a non-empty subset of the canonical allowlist (`tAAPL`, `tTSLA`, `tNVDA`); unknown tickers cannot be added via environment configuration. |
| `KYROX_ALLOWED_RECIPIENTS` | Optional | *(unset — any valid non-zero, non-contract EVM address)* | Optional comma-separated allowlist of recipient wallet addresses on Base Sepolia. Every entry is validated as a non-zero EIP-55 address. |
| `KYROX_INTENT_TTL_SECONDS` | Optional | `300` | Expiration window in seconds (`1` to `86400`) for unsigned transaction intents produced by `prepare_transaction`. |
| `KYROX_LOG_DIR` | Optional | `logs` | Directory where structured, redacted JSONL audit logs are written. |
| `KYROX_LOG_FILE` | Optional | `audit.jsonl` | Active JSONL audit log filename inside `KYROX_LOG_DIR`. |
| `KYROX_LOG_MAX_BYTES` | Optional | `5242880` (5 MiB) | Maximum size in bytes of the active audit log file before rotating to `.1`..`.N`. |
| `KYROX_LOG_BACKUP_COUNT` | Optional | `5` | Number of rotated backup audit log files retained. |

---

## 9. Connecting to Claude Desktop

Claude Desktop loads MCP servers from `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add a `"kyrox-mcp"` entry inside the `"mcpServers"` object using **absolute paths** to the virtual environment's Python interpreter and `server.py` (or the installed `kyrox-mcp` script). Replace `<ABSOLUTE_PATH_TO_KYROX_REPO>` with your actual local directory path:

### macOS / Linux (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "kyrox-mcp": {
      "command": "<ABSOLUTE_PATH_TO_KYROX_REPO>/.venv/bin/python",
      "args": [
        "<ABSOLUTE_PATH_TO_KYROX_REPO>/server.py"
      ]
    }
  }
}
```

### Windows (`%APPDATA%\Claude\claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "kyrox-mcp": {
      "command": "<ABSOLUTE_PATH_TO_KYROX_REPO>\\.venv\\Scripts\\python.exe",
      "args": [
        "<ABSOLUTE_PATH_TO_KYROX_REPO>\\server.py"
      ]
    }
  }
}
```

**Important Notes for Claude Desktop:**
1. **Replace Placeholders:** On macOS, `<ABSOLUTE_PATH_TO_KYROX_REPO>` looks like `/Users/yourname/Projects/kyrox-mcp`. On Windows, use double backslashes in JSON, e.g., `C:\\Projects\\kyrox-mcp\\.venv\\Scripts\\python.exe`.
2. **Installed Console Script Alternative:** After running `python -m pip install .`, you can also set `"command"` directly to `"<ABSOLUTE_PATH_TO_KYROX_REPO>/.venv/bin/kyrox-mcp"` (macOS/Linux) or `"<ABSOLUTE_PATH_TO_KYROX_REPO>\\.venv\\Scripts\\kyrox-mcp.exe"` (Windows) with `"args": []`.
3. **Preserve Existing Entries:** If `"mcpServers"` already contains other servers, add `"kyrox-mcp"` alongside them rather than overwriting the file.
4. **Full Host Restart Required:** After saving `claude_desktop_config.json`, completely quit and restart Claude Desktop so it spawns the KYROX `stdio` server and discovers its 7 tools.

---

## 10. Connecting to Antigravity

Antigravity reads global MCP server definitions from:

- **macOS / Linux:** `~/.gemini/config/mcp_config.json`
- **Windows:** `%USERPROFILE%\.gemini\config\mcp_config.json`

Add `"kyrox-mcp"` under `"mcpServers"` while preserving any existing server entries:

### macOS / Linux (`~/.gemini/config/mcp_config.json`)
```json
{
  "mcpServers": {
    "kyrox-mcp": {
      "command": "<ABSOLUTE_PATH_TO_KYROX_REPO>/.venv/bin/python",
      "args": [
        "<ABSOLUTE_PATH_TO_KYROX_REPO>/server.py"
      ]
    }
  }
}
```

### Windows (`%USERPROFILE%\.gemini\config\mcp_config.json`)
```json
{
  "mcpServers": {
    "kyrox-mcp": {
      "command": "<ABSOLUTE_PATH_TO_KYROX_REPO>\\.venv\\Scripts\\python.exe",
      "args": [
        "<ABSOLUTE_PATH_TO_KYROX_REPO>\\server.py"
      ]
    }
  }
}
```

Once saved, refresh or reload the MCP Servers panel in Antigravity to verify that `kyrox-mcp` connects over `stdio` and lists all 7 tools (`hello_kyrox`, `list_stocks`, `get_stock_info`, `get_wallet_balances`, `get_portfolio`, `prepare_transaction`, `simulate_transaction`).

---

## 11. Verifying with MCP Inspector (or Direct STDIO)

### Option A: Browser-Based MCP Inspector (Requires Node.js LTS & `npx`)
With your virtual environment activated in the repository root:

```bash
mcp dev server.py
```

This launches the MCP Inspector web UI connected to `server.py` over `stdio`, allowing you to inspect tool schemas and invoke `hello_kyrox`, `list_stocks`, and `get_stock_info` interactively.

### Option B: Direct STDIO JSON-RPC Handshake Test (No Node.js Required)
You can verify the live `stdio` JSON-RPC 2.0 initialization handshake, tool discovery, and offline tool call directly with Python or `pytest`:

```bash
python -m pytest tests/test_stdio.py -v
```

---

## 12. Complete List of Registered MCP Tools (7 Tools)

KYROX registers **7 MCP tools** in [server.py](server.py). Every tool carries `ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, ...)` because KYROX never mutates on-chain state, never signs, and never broadcasts transactions:

| # | Tool Name | Arguments | Category | Status | Summary |
|---:|---|---|---|---|---|
| 1 | `hello_kyrox` | `name: str` | Connectivity (Offline) | `VERIFIED` | Return a redacted greeting confirming the KYROX MCP server is live. |
| 2 | `list_stocks` | *(none)* | Catalogue (Offline) | `VERIFIED` | Return all configured stock summaries (`ticker`, `name`, `reference_value`) from `data/stocks.json` (or `KYROX_STOCKS_FILE`) in source order. |
| 3 | `get_stock_info` | `ticker: str` | Catalogue (Offline) | `VERIFIED` | Case-insensitive lookup returning the full stock record (`ticker`, `stock`, `reference_value`, `token_address`) or an `{"error": ...}` dictionary. |
| 4 | `get_wallet_balances` | `wallet: str` | Base Sepolia Read | `IN PROGRESS` | Validate a public EIP-55 wallet address, verify Base Sepolia (`chainId: 84532`), read ERC-20 `balanceOf(wallet)` and `decimals()` on configured token contracts, and return non-zero balances. |
| 5 | `get_portfolio` | `wallet: str` | Base Sepolia Read & Valuation | `IN PROGRESS` | Combine Base Sepolia ERC-20 balances with qualified mock reference values using 100-digit `Decimal` arithmetic, enforce single-currency aggregation, track `unpriced_holdings`, and return `holdings`, `total_value`, and explicit `warnings`. |
| 6 | `prepare_transaction` | `from_wallet: str`, `ticker: str`, `to: str`, `amount: int \| float \| str` | Policy Gate & Unsigned Intent | `IN PROGRESS` | Enforce the pre-RPC safety policy (`<= 50` tokens, `tAAPL`/`tTSLA`/`tNVDA` allowlist, `requires_human_approval: true`), verify Base Sepolia (`chainId: 84532`) and contract `decimals()`, and build an **unsigned** ERC-20 `transfer(to, amount_base_units)` intent (`signed: false`, `broadcast: false`, `intent_hash`, `expires_at`). |
| 7 | `simulate_transaction` | `from_wallet: str`, `ticker: str`, `to: str`, `amount: int \| float \| str` | Policy Gate & EVM Dry-Run | `IN PROGRESS` | Independently enforce the pre-RPC safety policy, prepare and verify the unsigned intent, pin a single canonical Base Sepolia block number (`eth_blockNumber`), execute `eth_call` (decoding the 32-byte ERC-20 `bool` return value) and `eth_estimateGas` (in gas units), and return `would_succeed`, `estimated_gas`, `signed: false`, and `broadcast: false`. |

---

## 13. Tool Usage Examples

All wallet addresses shown below (`0x71C7656EC7ab88b098defB751B7401B5f6d8976F` and `0x2222222222222222222222222222222222222222`) are **public placeholder test addresses**. No fabricated balances are presented as live Base Sepolia data.

### 1. `hello_kyrox` (Offline Connectivity Check)

**Arguments:**
```json
{
  "name": "Developer"
}
```

**Response:**
```text
Hello Developer, KYROX is live.
```

### 2. `list_stocks` (Offline Stock Catalogue Summary)

**Arguments:**
```json
{}
```

**Response:**
```json
[
  {
    "ticker": "tAAPL",
    "name": "Test Apple",
    "reference_value": 230.0
  },
  {
    "ticker": "tTSLA",
    "name": "Test Tesla",
    "reference_value": 250.0
  },
  {
    "ticker": "tNVDA",
    "name": "Test Nvidia",
    "reference_value": 140.0
  }
]
```

### 3. `get_stock_info` (Offline Ticker Lookup)

**Arguments:**
```json
{
  "ticker": "tAAPL"
}
```

**Response (Default Packaged `data/stocks.json`):**
```json
{
  "ticker": "tAAPL",
  "stock": "Test Apple",
  "reference_value": 230.0,
  "token_address": ""
}
```

### 4. `get_wallet_balances` (Base Sepolia ERC-20 Balance Reader)

**Arguments (Placeholder Public Wallet Address):**
```json
{
  "wallet": "0x71C7656EC7ab88b098defB751B7401B5f6d8976F"
}
```

**Response with Default Packaged `data/stocks.json` (`token_address: ""` entries skipped after Base Sepolia chain check):**
```json
{
  "wallet": "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
  "chain": "base-sepolia",
  "balances": []
}
```

### 5. `get_portfolio` (Base Sepolia Portfolio Valuation with Provenance Envelope)

**Arguments (Placeholder Public Wallet Address):**
```json
{
  "wallet": "0x71C7656EC7ab88b098defB751B7401B5f6d8976F"
}
```

**Response with Default Packaged `data/stocks.json` (`token_address: ""` unconfigured):**
```json
{
  "wallet": "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
  "chain": "base-sepolia",
  "chain_id": 84532,
  "environment": "mock",
  "valuation_basis": "mock_reference_value",
  "currency": "USD",
  "holdings": [],
  "total_value": 0.0,
  "total_value_decimal": "0.00",
  "holding_count": 0,
  "priced_holding_count": 0,
  "unpriced_holdings": [],
  "warnings": [
    "No deployed token contract addresses are configured in the stock dataset; all unconfigured entries were skipped.",
    "Reference values are static mock demonstration fixtures on Base Sepolia (chainId: 84532) and do not represent live equity market prices or real share ownership."
  ]
}
```

### 6. `prepare_transaction` (Pre-RPC Policy Gate & Unsigned ERC-20 Intent Builder)

**Example A — Over-Limit Request Blocked Deterministically by Policy Before Any RPC Call (`amount: 100 > 50`):**
```json
{
  "from_wallet": "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
  "ticker": "tAAPL",
  "to": "0x2222222222222222222222222222222222222222",
  "amount": 100
}
```

**Response:**
```json
{
  "error": "Transaction amount 100 exceeds maximum allowed limit (50).",
  "error_code": "POLICY_REJECTED",
  "error_category": "policy",
  "retryable": false,
  "status": "rejected",
  "signed": false,
  "broadcast": false,
  "requires_human_approval": true,
  "requires_external_signature": true,
  "signing_mode": "external_wallet_only",
  "policy": {
    "passed": false,
    "allowed": false,
    "requires_human_approval": true,
    "chain_verified": true,
    "allowed_chain_id": 84532,
    "ticker": "tAAPL",
    "ticker_approved": false,
    "allowed_tickers": [
      "tAAPL",
      "tTSLA",
      "tNVDA"
    ],
    "contract_verified": true,
    "recipient_allowed": true,
    "amount_decimal": "100",
    "max_amount": "50",
    "reasons": [
      "Transaction amount 100 exceeds maximum allowed limit (50)."
    ],
    "error_code": "POLICY_REJECTED",
    "error_category": "policy",
    "policy_version": "v0.1-day11"
  }
}
```

**Example B — Allowed Amount (`amount: 10 <= 50`) Against Default Packaged `data/stocks.json` (`token_address: ""`):**
When `amount` passes the 50-token policy check (`10 <= 50`) but `token_address` is blank in `data/stocks.json`, `prepare_transaction` safely returns `MISSING_CONFIGURATION` (`"Missing required configuration: token contract address for tAAPL is not configured in the stock dataset."`, `signed: false`, `broadcast: false`, `requires_human_approval: true`). When a deployed Base Sepolia mock token address is supplied via `KYROX_STOCKS_FILE`, it returns `status: "prepared"`, `signed: false`, `broadcast: false`, `intent_hash`, `expires_at`, and `unsigned_tx` (with `unsigned_tx.to` targeting the ERC-20 token contract and `unsigned_tx.data` containing `0xa9059cbb...` `transfer(address,uint256)` calldata).

### 7. `simulate_transaction` (Pre-RPC Policy Gate & Pinned-Block EVM Dry-Run)

**Arguments (`amount: 100` blocked by pre-RPC policy; or `amount: 10` dry-run):**
```json
{
  "from_wallet": "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
  "ticker": "tAAPL",
  "to": "0x2222222222222222222222222222222222222222",
  "amount": 10
}
```

**Behavior & Response:**
- `simulate_transaction` independently runs the same pre-RPC safety policy gate (`tools/policy.py`) before invoking `prepare_transaction`, `eth_call`, or `eth_estimateGas`.
- With default packaged `data/stocks.json` (`token_address: ""`), `amount: 10` returns `MISSING_CONFIGURATION` (`signed: false`, `broadcast: false`, `requires_human_approval: true`).
- With a configured Base Sepolia token contract (or deterministic test fixture in `tests/test_tx.py`), `simulate_transaction` captures a single canonical `block_number` via `eth_blockNumber`, executes `eth_call` using an allowlisted EIP-1474 call dictionary (`from`, `to`, `data`, `value: 0`), decodes the 32-byte ERC-20 `bool` return word, calls `eth_estimateGas` against the same block snapshot, and returns `would_succeed: true`, `estimated_gas` (in `"gas"` units), `block_number`, `signed: false`, `broadcast: false`, and `requires_human_approval: true`.

---

## 14. Error & Response Format

All KYROX tools use a deterministic, secret-redacted error taxonomy defined in [tools/errors.py](tools/errors.py) and [tools/policy.py](tools/policy.py):

1. **Standard Tool Error Envelope (`get_wallet_balances`, `get_portfolio`, uncaught `KyroxError` via `@audit_tool_call`):**
   ```json
   {
     "error": "Invalid Ethereum wallet address: 0x123",
     "error_code": "INVALID_WALLET_ADDRESS",
     "error_category": "validation",
     "retryable": false
   }
   ```
2. **Transaction & Safety Policy Rejection Envelope (`prepare_transaction`, `simulate_transaction`):**
   Every denied transaction or policy response retains non-custodial safety invariants alongside the structured `policy` decision block:
   - `error` (`str`): Human-readable, secret-redacted rejection message.
   - `error_code` (`str`): Machine-readable code (`POLICY_REJECTED`, `MISSING_CONFIGURATION`, `INVALID_CONFIGURATION`, `INVALID_WALLET_ADDRESS`, `ZERO_ADDRESS_NOT_ALLOWED`, `DECIMAL_PRECISION_ERROR`, `UNSUPPORTED_CHAIN_ID`, `INSUFFICIENT_TOKEN_BALANCE`, `SIMULATION_REVERTED`, `ERC20_TRANSFER_FALSE`, `INTENT_EXPIRED`, `INTENT_TAMPERED`, `RPC_TIMEOUT`, `RPC_CONNECTION_FAILED`, `MALFORMED_PROVIDER_RESPONSE`, `INTERNAL_ERROR`).
   - `error_category` (`str`): Category (`policy`, `validation`, `configuration`, `chain`, `simulation`, `rpc`, `contract`, `audit`).
   - `retryable` (`bool`): `true` only for transient RPC transport timeouts/connection failures; `false` for all validation, policy, configuration, and on-chain revert errors.
   - `status`: `"rejected"` (or `"simulated"` with `would_succeed: false` for on-chain simulation reverts).
   - `signed`: `false`, `broadcast`: `false`, `requires_human_approval`: `true`, `requires_external_signature`: `true`, `signing_mode`: `"external_wallet_only"`.

---

## 15. Security Rules & Non-Custodial Limitations

Please read [SECURITY.md](SECURITY.md) before using or contributing to KYROX. Core invariants enforced in code and tests:

- **No Private Keys or Seed Phrases:** KYROX never asks for, accepts, stores, logs, or transmits private keys, seed phrases, recovery codes, or API secrets.
- **No Signing or Broadcasting:** KYROX contains zero `sign_transaction`, `send_transaction`, or `send_raw_transaction` code paths (enforced via AST inspection tests in `tests/test_tx.py`). Every transaction response returns `signed: false` and `broadcast: false`.
- **50-Token Maximum & Strict 3-Ticker Allowlist (`tools/policy.py`):** Transaction tools enforce a default `50`-token per-transaction cap (`amount <= 50` inclusive; configurable downward via `KYROX_MAX_TOKEN_AMOUNT` / `KYROX_MAX_TX_AMOUNT`, never above `50`) and restrict transfers strictly to `tAAPL`, `tTSLA`, and `tNVDA`.
- **Policy Verdict $\neq$ Human Approval:** Passing a policy check or `eth_call` dry run only means the parameters passed automated pre-checks at a single block height; every decision retains `requires_human_approval: true`.
- **Fail-Closed Redacted Audit Logging (`tools/log.py`):** Every tool call and policy decision is scrubbed by `redact_sensitive_data()` and logged to `logs/audit.jsonl`. If audit logging fails on an allowed transaction operation, KYROX fails closed and rejects the operation.
- **Exact Financial Arithmetic:** Token quantities and portfolio valuations use integer base units and 100-digit Python `Decimal` arithmetic—never binary floating-point conversion.
- **Clean `stdio` Protocol Output:** Server diagnostics never print to `stdout`, preventing JSON-RPC frame corruption.

---

## 16. Dataset & Mock-Data Limitations

- **Base Sepolia Testnet & Mock Fixtures Only:** KYROX `v0.1` operates exclusively on **Base Sepolia testnet (`chainId: 84532`)** and local mock stock fixtures (`data/stocks.json`). It does not connect to mainnet execution venues or trade real equities.
- **Why `token_address` Is Blank in Packaged `data/stocks.json`:** Packaged `data/stocks.json` keeps `token_address: ""` in version control so invented or unverified contract addresses are never distributed as defaults. When you deploy `contracts/MockStock.sol` to Base Sepolia, store your deployed checksummed addresses in a local git-ignored JSON file and set `KYROX_STOCKS_FILE` to its path (see [data/README.md](data/README.md)).
- **Mock ERC-20 Tokens $\neq$ Regulated Securities:** Testnet mock tokens do not model regulated issuance, corporate actions, dividend/split multipliers, off-hours market halts, or live order-book liquidity.
- **Reference Values Are Not Live Quotes:** Any `reference_value` in `data/stocks.json` (`230.0`, `250.0`, `140.0`) is static test data (`valuation_basis: "mock_reference_value"`) and must never be treated as a live market price.
- **Point-in-Time Simulation Caveat:** `eth_call` and `eth_estimateGas` evaluate Base Sepolia state at a single block snapshot and do not guarantee that a transaction signed later will succeed on-chain.
- **Not Audited / Not Financial Advice:** KYROX is an experimental open-source technical prototype and has not undergone an independent security audit. Nothing in this repository constitutes financial, investment, legal, or tax advice. KYROX has **no token**, no token sale, and no airdrop or yield program.

---

## 17. Running Tests

Activate your virtual environment and run the full automated test suite with `pytest`:

```bash
# Run the full test suite (quiet summary)
python -m pytest -q

# Run the full test suite with verbose test names
python -m pytest -v

# Run specific test modules
python -m pytest tests/test_environment_smoke.py tests/test_stdio.py -v
python -m pytest tests/test_stocks.py tests/test_wallet.py tests/test_portfolio.py -v
python -m pytest tests/test_tx.py tests/test_policy.py tests/test_logging_and_errors.py -v

# Verify dependency consistency
python -m pip check
```

All tests isolate audit logs into temporary `pytest` directories (`tests/conftest.py`) and use deterministic mock Web3 providers for positive transaction/portfolio tests so the test suite passes 100% offline without requiring private keys or live testnet funds.

---

## 18. Troubleshooting

| Symptom / ErrorCode | Cause | Resolution |
|---|---|---|
| `kyrox-mcp` or `python server.py` appears to hang in terminal | Normal MCP `stdio` behavior | The server is waiting on `stdin` for JSON-RPC 2.0 messages from an MCP host (Claude Desktop, Antigravity, or `mcp dev server.py`). Press `Ctrl+C` to exit. |
| `MISSING_CONFIGURATION`: `"token contract address for tAAPL is not configured in the stock dataset"` | Packaged `data/stocks.json` has `token_address: ""` by default | Expected when no Base Sepolia mock token contracts are configured. To test with deployed `MockStock.sol` contracts on Base Sepolia, create a local JSON copy with checksummed `token_address` values and set `KYROX_STOCKS_FILE=/absolute/path/to/stocks.local.json`. |
| `get_wallet_balances` returns `"balances": []` or `get_portfolio` warns `"No deployed token contract addresses are configured"` | Packaged `data/stocks.json` has blank `token_address` fields (or wallet holds `0` tokens) | Supply deployed Base Sepolia mock token addresses via `KYROX_STOCKS_FILE` and query a wallet that holds those test tokens. |
| `UNSUPPORTED_CHAIN_ID` | `BASE_RPC_URL` points to Base Mainnet (`8453`), Ethereum Mainnet (`1`), or another chain | Set `BASE_RPC_URL=https://sepolia.base.org` (or another Base Sepolia RPC endpoint returning `chainId: 84532`). |
| `POLICY_REJECTED`: `"Transaction amount ... exceeds maximum allowed limit (50)"` | Requested `amount > 50` (or above `KYROX_MAX_TOKEN_AMOUNT`) | Keep per-transaction token amounts `<= 50` and use an approved ticker (`tAAPL`, `tTSLA`, `tNVDA`). |
| `INVALID_WALLET_ADDRESS` or `ZERO_ADDRESS_NOT_ALLOWED` | Malformed hex address, corrupted mixed-case EIP-55 checksum, or `0x0000...0000` | Provide a valid 42-character EIP-55 checksummed (or all-lowercase hex) public wallet address. |
| Tools do not appear in Claude Desktop or Antigravity after editing config | Host did not reload MCP configuration or paths in JSON are relative/invalid | Verify that `"command"` and `"args"` use valid absolute paths (with escaped `\\` on Windows), run `python -m json.tool` on the config file to check JSON syntax, and fully restart the host application. |

---

## 19. Early Tester Programme, Bug Reporting & Contribution Rewards

KYROX is opening its **Early Tester Programme** (Chapter 1, Day 13) to a small group of **five external builders** who want to connect KYROX (`kyrox-mcp`) to their AI agent workflows, test its 7 MCP tools and safety policy engine on Base Sepolia, and report reproducible bugs before wider release.

### Who Should Apply

- Developers building **AI agents**, **MCP client integrations** (Claude Desktop, Antigravity, MCP Inspector, or custom STDIO hosts), or **on-chain financial copilot workflows** on Base.
- Builders willing to test read-only stock/portfolio queries (`list_stocks`, `get_stock_info`, `get_wallet_balances`, `get_portfolio`), unsigned transaction preparation (`prepare_transaction`), and pinned-block EVM dry runs (`simulate_transaction`), and provide actionable engineering feedback.

### Early Tester Registration Form (`KYROX — Early Tester Application`)

- **Registration Form Status:** `PENDING_OWNER_FORM_PUBLICATION` — The external Tally / Google Forms registration link (`KYROX — Early Tester Application`) requires manual publication in an authenticated browser session by the project owner. No placeholder or fabricated form URL is published here; this section will be updated with the verified live form URL immediately upon owner publication.
- **Information Collected on Registration:**
  1. **Name** *(required)*
  2. **X handle** *(required — with or without `@`)*
  3. **Base Sepolia wallet address** *(required — public receiving address only on Base Sepolia `chainId: 84532`, starting with `0x` followed by 40 hexadecimal characters; never submit private keys or seed phrases)*
  4. **What AI agent are you building?** *(required — agent framework, use case, and what you intend to test with KYROX)*
  5. **Testnet & Security Consent** *(required — confirming understanding that this is a Base Sepolia testnet-only programme, mock stock tokens have no monetary value, and no private keys, seed phrases, or passwords will ever be submitted)*

### How to Report Bugs & Security Issues

- **Reproducible Non-Security Bugs:** Use the official GitHub Bug Report issue form defined in [.github/ISSUE_TEMPLATE/bug_report.yml](.github/ISSUE_TEMPLATE/bug_report.yml) (`https://github.com/SAIFew/kyrox-mcp/issues/new?template=bug_report.yml` once GitHub Issues is enabled on the repository and the template is merged into the default `main` branch). Include your KYROX version/commit, environment (`Local installation`, `Base Sepolia`, or `Other, with explanation`), numbered reproduction steps, expected vs. actual behaviour, and redacted logs.
- **Security Vulnerabilities:** Do **not** post public exploit details in a GitHub Issue. Disclose security vulnerabilities privately via **GitHub Private Vulnerability Reporting** (`Security -> Advisories -> Report a vulnerability`) in accordance with [SECURITY.md](SECURITY.md).
- **Mandatory Secret Hygiene:** Never upload private keys, recovery/seed phrases, `.env` files, wallet passwords, or live API credentials in any bug report, screenshot, or log snippet.

### Contribution Rewards & Planned Early Builder Badge (`BOUNTY.md`)

See [BOUNTY.md](BOUNTY.md) for the complete reward rules, qualification criteria, funding disclosures, and planned Early Builder badge status:

- **Active Day 13 Categories:**
  - **Bug Bounty:** `$10–$50 USDC` per confirmed, reproducible bug (final severity and award within the `$10–$50` range determined by the maintainer with a clear explanation).
  - **First Integrations:** `$25 USDC` for each of the first 6 qualifying, independently verifiable AI agent integrations with a genuine screen recording (`$150 USDC` maximum planned allocation).
- **Future Categories (Not Active on Day 13):**
  - **Feature Idea That Ships:** `$50 USDC` + Feature Drop attribution *(starts Day 14 — November 21, 2026)*.
  - **Community Challenge:** `$150 USDC` split across the top 3 contributions *(starts Chapter 2, Week 2)*.
- **Planned Early Builder Badge:** Free, non-transferable onchain recognition badge planned on Base for verified testers, bug reporters, and integrators (*currently `PLANNED / PENDING DEPLOYMENT` — no badge contract is deployed in `contracts/`, not a financial token, and carries zero promise or hint of future token conversion or airdrops*).

### Base Sepolia Testnet-Only Warning & Asset Distinction

> **Critical Distinction — Mock Stock Tokens vs. USDC Contribution Rewards:**
> 1. **Testnet Mock Stock Tokens (`tAAPL`, `tTSLA`, `tNVDA`):** Exist solely on **Base Sepolia testnet (`chainId: 84532`)** via [contracts/MockStock.sol](contracts/MockStock.sol) for functional testing of KYROX MCP tools. They have **zero monetary value**, do not represent real equities, and are currently awaiting manual owner deployment (`token_address: ""` in packaged [data/stocks.json](data/stocks.json)).
> 2. **USDC Contribution Rewards ([BOUNTY.md](BOUNTY.md)):** Are separate off-protocol contribution incentives subject to independent maintainer verification, owner confirmation of reward funding and payout network (the original playbook suggests a `$400 USDC` pool across Chapter 1 and early Chapter 2 without confirming escrow or payout network), and appropriate tax and legal review prior to distribution.

---

## 20. License

Licensed under the **Apache License, Version 2.0** (`Apache-2.0`). See the [LICENSE](LICENSE) file for the full license text.
