#!/usr/bin/env bash
# Full local consumer journey: Anvil + temporary PostgreSQL + Next server + API smoke.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pnpm --filter @kyrox/web build >/dev/null

PORT=$(( (RANDOM % 700) + 8600 ))
APP_PORT=$(( (RANDOM % 400) + 3200 ))
ANVIL_LOG="$(mktemp /tmp/kyrox-anvil.XXXXXX.log)"
ANVIL_PID=""

cleanup() {
  if [ -n "$ANVIL_PID" ]; then kill "$ANVIL_PID" >/dev/null 2>&1 || true; fi
  rm -f "$ANVIL_LOG"
}
trap cleanup EXIT INT TERM

"$HOME/.foundry/bin/anvil" --port "$PORT" --chain-id 84532 --silent >"$ANVIL_LOG" 2>&1 &
ANVIL_PID=$!
for _ in $(seq 1 50); do
  if "$HOME/.foundry/bin/cast" chain-id --rpc-url "http://127.0.0.1:$PORT" >/dev/null 2>&1; then break; fi
  sleep 0.1
done

export BASE_SEPOLIA_RPC_URL="http://127.0.0.1:$PORT"
export APP_PORT
export KYROX_ENVIRONMENT=local-anvil
export KYROX_DEPLOYMENT_MANIFEST="$ROOT/deployments/local-anvil.json"
export AUTH_SECRET="$(openssl rand -hex 24)"
export NEXT_TELEMETRY_DISABLED=1

bash scripts/with-postgres.sh bash -c '
  set -euo pipefail
  pnpm --filter @kyrox/db exec drizzle-kit migrate >/dev/null
  if ! pnpm tsx scripts/local-bootstrap.ts >/tmp/kyrox-bootstrap.log 2>&1; then cat /tmp/kyrox-bootstrap.log; exit 1; fi
  pnpm --filter @kyrox/web exec next start -p "$APP_PORT" >/tmp/kyrox-next.log 2>&1 &
  APP_PID=$!
  trap "kill $APP_PID >/dev/null 2>&1 || true" EXIT
  for _ in $(seq 1 100); do
    if curl -sf "http://127.0.0.1:$APP_PORT/api/assets" >/dev/null; then break; fi
    sleep 0.2
  done
  APP_URL="http://127.0.0.1:$APP_PORT" BASE_SEPOLIA_RPC_URL="$BASE_SEPOLIA_RPC_URL" \
    KYROX_DEPLOYMENT_MANIFEST="$KYROX_DEPLOYMENT_MANIFEST" \
    pnpm tsx scripts/local-smoke.ts
  APP_URL="http://127.0.0.1:$APP_PORT" BASE_SEPOLIA_RPC_URL="$BASE_SEPOLIA_RPC_URL" \
    pnpm exec playwright test --config apps/web/playwright.config.ts
'
