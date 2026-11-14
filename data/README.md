# KYROX Stock Catalogue Fixtures (`data/`)

## Overview

This directory contains the local tokenized-stock catalogue (`data/stocks.json`) consumed by the KYROX MCP server (`tools/stocks.py` and `tools/wallet.py`).

## Current Status (`v0.1` Mock & Base Sepolia Testnet)

- **Environment:** Labelled mock fixtures (`mock`) and **Base Sepolia testnet (`chainId: 84532`)** only.
- **Not Live Market Data:** Each `reference_value` in `data/stocks.json` (`230.0`, `250.0`, `140.0`) is a static development fixture. It is **not** a live equity market quote, real-time feed, or executable price.
- **Contract Addresses:** The `token_address` field for `tAAPL` ("Test Apple"), `tTSLA` ("Test Tesla"), and `tNVDA` ("Test Nvidia") is kept blank (`""`) in version control until the corresponding `contracts/MockStock.sol` ERC-20 contracts are deployed on Base Sepolia (`chainId: 84532`) and verified. Blank `token_address` entries are cleanly skipped by `get_wallet_balances`.

## Record Schema & Validation Invariants

Every entry in `data/stocks.json` is validated by `tools/stocks.py` (`load_stocks()`) before use:

| Field | Type | Validation Rules |
|---|---|---|
| `ticker` | `str` | Required, non-empty string, unique across the dataset (case-insensitive). |
| `stock` | `str` | Required, non-empty human-readable instrument name. |
| `reference_value` | `int \| float` | Required, finite positive number (`> 0`). Booleans, `NaN`, and `Infinity` are rejected. |
| `token_address` | `str` | Required string. Either blank (`""`) for unconfigured mock fixtures or a valid non-zero EIP-55 checksummed EVM contract address on Base Sepolia (`chainId: 84532`). |

