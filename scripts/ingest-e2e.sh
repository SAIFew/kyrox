#!/usr/bin/env bash
# One-shot CLI against a disposable PostgreSQL cluster and read-only Base RPC.
set -euo pipefail
BASE_RPC="${BASE_MAINNET_RPC_URL:-https://base-rpc.publicnode.com}"
exec "$(dirname "$0")/with-postgres.sh" \
  env BASE_MAINNET_RPC_URL="$BASE_RPC" \
      PRICE_ALLOWED_TICKERS="${PRICE_ALLOWED_TICKERS:-tAAPL,tTSLA,tNVDA}" \
      PRICE_MAX_SOURCE_AGE_SECONDS="${PRICE_MAX_SOURCE_AGE_SECONDS:-3600}" \
      KYROX_DEPLOYMENT_MANIFEST="${KYROX_DEPLOYMENT_MANIFEST:-deployments/base-sepolia.json}" \
  bash -c 'pnpm --filter @kyrox/db exec drizzle-kit migrate && pnpm price:ingest'
