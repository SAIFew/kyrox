# KYROX Stock Catalogue Fixtures (`data/`)

## Overview

This directory contains the local tokenized-stock catalogue (`data/stocks.json`) consumed by the KYROX MCP server (`tools/stocks.py`, `tools/wallet.py`, and `tools/tx.py` for `get_stock_info`, `list_stocks`, `get_wallet_balances`, `get_portfolio`, `prepare_transaction`, and `simulate_transaction`).

## Custom Dataset Override (`KYROX_STOCKS_FILE`)

Keep the packaged `data/stocks.json` fixture unchanged in version control (`token_address: ""` for all records). When testing deployed Base Sepolia mock token contracts (`contracts/MockStock.sol`), store the deployed addresses in `planning/deployments/stocks.local.json` (which is ignored by Git and must never be committed) and set the `KYROX_STOCKS_FILE` environment variable to that file path.

## Current Status (`v0.1` Mock & Base Sepolia Testnet)

- **Environment:** Labelled mock fixtures (`mock`) and **Base Sepolia testnet (`chainId: 84532`)** only.
- **Not Live Market Data:** Each `reference_value` in `data/stocks.json` (`230.0`, `250.0`, `140.0`) is a static development fixture (`valuation_basis: "mock_reference_value"`). It is **not** a live equity market quote, real-time feed, or executable price.
- **Contract Addresses:** The `token_address` field for `tAAPL` ("Test Apple"), `tTSLA` ("Test Tesla"), and `tNVDA` ("Test Nvidia") in packaged `data/stocks.json` is kept permanently blank (`""`) in version control. Deployed Base Sepolia (`chainId: 84532`) mock token addresses are supplied locally via `KYROX_STOCKS_FILE` (`planning/deployments/stocks.local.json`) and are never committed to the repository. Blank `token_address` entries are cleanly skipped by `get_wallet_balances` and `get_portfolio`, and safely rejected (`MISSING_CONFIGURATION`) by `prepare_transaction` and `simulate_transaction`.

## Record Schema & Validation Invariants

Every entry in `data/stocks.json` is validated by `tools/stocks.py` (`load_stocks()`) and `tools/wallet.py` (`get_portfolio()`) before use:

| Field | Type | Validation Rules |
|---|---|---|
| `ticker` | `str` | Required, non-empty string, unique across the dataset (case-insensitive). |
| `stock` | `str` | Required, non-empty human-readable instrument name. |
| `reference_value` | `int \| float` | Required in `data/stocks.json`, finite positive number (`> 0`). Booleans, `NaN`, and `Infinity` are rejected. In custom portfolio records, a missing/`null` or `stale: true` reference value marks the holding as `unpriced` (`priced: false`, `value: null`) and excludes it from `total_value`. |
| `token_address` | `str` | Required string. Either blank (`""`) for unconfigured mock fixtures or a valid non-zero EIP-55 checksummed EVM contract address on Base Sepolia (`chainId: 84532`). |
| `decimals` | `int` *(optional)* | Optional integer between `0` and `77`. When specified, `get_portfolio` verifies that the on-chain ERC-20 `decimals()` call matches this configured value. |
| `currency` | `str` *(optional)* | Optional ISO currency code (defaults to `"USD"`). `get_portfolio` only aggregates holdings that share a single compatible currency; mixed-currency portfolios set `total_value: null` and `currency: null` with an explicit warning. |

