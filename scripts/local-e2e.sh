#!/usr/bin/env bash
# Full local consumer journey: temporary Next build + demo Playwright + Anvil,
# disposable PostgreSQL, wallet API smoke, and the local-Anvil wallet Playwright flow.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/kyrox-local-e2e.XXXXXX")"
BUILD_ROOT="$WORK/apps/web"
MANIFEST_PATH="$WORK/local-anvil.json"
BUILD_LOG="$WORK/next-build.log"
DEMO_LOG="$WORK/next-demo.log"
ANVIL_LOG="$WORK/anvil.log"
DEMO_PID=""
ANVIL_PID=""

cleanup() {
  if [ -n "$DEMO_PID" ]; then stop_pid "$DEMO_PID"; fi
  if [ -n "$ANVIL_PID" ]; then stop_pid "$ANVIL_PID"; fi
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

stop_pid() {
  local pid="$1"
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
    for _ in $(seq 1 50); do
      if ! kill -0 "$pid" >/dev/null 2>&1; then break; fi
      sleep 0.1
    done
    if kill -0 "$pid" >/dev/null 2>&1; then kill -KILL "$pid" >/dev/null 2>&1 || true; fi
  fi
  wait "$pid" >/dev/null 2>&1 || true
}

pick_port() {
  local candidate
  for _ in $(seq 1 100); do
    candidate=$(( (RANDOM % 1800) + 8400 ))
    if ! nc -z 127.0.0.1 "$candidate" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  echo "Could not find a free loopback port." >&2
  return 1
}

wait_for_http() {
  local url="$1" pid="$2" log="$3"
  for _ in $(seq 1 150); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "Server exited before becoming ready: $url" >&2
      cat "$log" >&2 || true
      return 1
    fi
    if curl -sf "$url" >/dev/null 2>&1; then return 0; fi
    sleep 0.2
  done
  echo "Timed out waiting for $url" >&2
  cat "$log" >&2 || true
  return 1
}

# Build a disposable mirror. Next owns and may delete its distDir, so never point
# a harness build at the source tree's existing .next directory.
mkdir -p "$BUILD_ROOT"
rsync -a \
  --exclude node_modules \
  --exclude .next \
  --exclude test-results \
  --exclude playwright-report \
  --exclude '.env*' \
  "$ROOT/apps/web/" "$BUILD_ROOT/"
cp "$ROOT/tsconfig.base.json" "$WORK/tsconfig.base.json"
mkdir -p "$WORK/scripts"
cp "$ROOT/scripts/local-smoke.ts" "$WORK/scripts/local-smoke.ts"
ln -s "$ROOT/apps/web/node_modules" "$BUILD_ROOT/node_modules"
ln -s "$ROOT/node_modules" "$WORK/node_modules"
NEXT_BIN="$ROOT/apps/web/node_modules/.bin/next"
export NEXT_TELEMETRY_DISABLED=1

if ! (cd "$BUILD_ROOT" && "$NEXT_BIN" build --webpack) >"$BUILD_LOG" 2>&1; then
  cat "$BUILD_LOG" >&2
  exit 1
fi
echo "✓ production build completed in $BUILD_ROOT/.next"

AUTH_SECRET="$(openssl rand -hex 24)"
export AUTH_SECRET
export PLAYWRIGHT_OUTPUT_DIR="$WORK/playwright-demo"

# Demo tests run first and never require Anvil, PostgreSQL, or an injected wallet.
DEMO_PORT="$(pick_port)"
DEMO_URL="http://127.0.0.1:$DEMO_PORT"
(
  cd "$BUILD_ROOT"
  exec env KYROX_DEMO_MODE=1 KYROX_ENVIRONMENT=demo DATABASE_URL= \
    APP_ORIGIN="$DEMO_URL" "$NEXT_BIN" start -p "$DEMO_PORT"
) >"$DEMO_LOG" 2>&1 &
DEMO_PID=$!
wait_for_http "$DEMO_URL/api/auth/session" "$DEMO_PID" "$DEMO_LOG"
DEMO_URL="$DEMO_URL" pnpm exec playwright test --config apps/web/playwright.config.ts --project=demo
stop_pid "$DEMO_PID"
DEMO_PID=""
echo "✓ chain-independent consumer and responsive Playwright suite passed"

ANVIL_BIN="${ANVIL_BIN:-$HOME/.foundry/bin/anvil}"
CAST_BIN="${CAST_BIN:-$HOME/.foundry/bin/cast}"
ANVIL_PORT="$(pick_port)"
"$ANVIL_BIN" --port "$ANVIL_PORT" --chain-id 84532 --silent >"$ANVIL_LOG" 2>&1 &
ANVIL_PID=$!
for _ in $(seq 1 100); do
  if [ "$("$CAST_BIN" chain-id --rpc-url "http://127.0.0.1:$ANVIL_PORT" 2>/dev/null || true)" = "84532" ]; then
    break
  fi
  if ! kill -0 "$ANVIL_PID" >/dev/null 2>&1; then cat "$ANVIL_LOG" >&2; exit 1; fi
  sleep 0.1
done
if [ "$("$CAST_BIN" chain-id --rpc-url "http://127.0.0.1:$ANVIL_PORT" 2>/dev/null || true)" != "84532" ]; then
  echo "Anvil did not become ready on chain 84532." >&2
  cat "$ANVIL_LOG" >&2 || true
  exit 1
fi

APP_PORT="$(pick_port)"
APP_URL="http://127.0.0.1:$APP_PORT"
export BASE_SEPOLIA_RPC_URL="http://127.0.0.1:$ANVIL_PORT"
export APP_PORT APP_URL
export KYROX_ENVIRONMENT=local-anvil
export KYROX_DEMO_MODE=0
export APP_ORIGIN="$APP_URL"
export KYROX_DEPLOYMENT_MANIFEST="$MANIFEST_PATH"
export KYROX_E2E_BUILD_ROOT="$BUILD_ROOT"
export KYROX_E2E_NEXT_BIN="$NEXT_BIN"
export KYROX_E2E_APP_LOG="$WORK/next-app.log"

TMPDIR="$WORK" bash scripts/with-postgres.sh bash -c '
  set -euo pipefail
  MIGRATE_LOG="$KYROX_E2E_BUILD_ROOT/../migrate.log"
  BOOTSTRAP_LOG="$KYROX_E2E_BUILD_ROOT/../bootstrap.log"
  if ! pnpm --filter @kyrox/db exec drizzle-kit migrate >"$MIGRATE_LOG" 2>&1; then
    cat "$MIGRATE_LOG" >&2
    exit 1
  fi
  if ! pnpm tsx scripts/local-bootstrap.ts >"$BOOTSTRAP_LOG" 2>&1; then
    cat "$BOOTSTRAP_LOG" >&2
    exit 1
  fi
  (
    cd "$KYROX_E2E_BUILD_ROOT"
    exec "$KYROX_E2E_NEXT_BIN" start -p "$APP_PORT"
  ) >"$KYROX_E2E_APP_LOG" 2>&1 &
  APP_PID=$!
  trap "kill $APP_PID >/dev/null 2>&1 || true" EXIT INT TERM
  for _ in $(seq 1 150); do
    if ! kill -0 "$APP_PID" >/dev/null 2>&1; then
      cat "$KYROX_E2E_APP_LOG" >&2
      exit 1
    fi
    if curl -sf "$APP_URL/api/assets" >/dev/null 2>&1; then break; fi
    sleep 0.2
  done
  if ! curl -sf "$APP_URL/api/assets" >/dev/null 2>&1; then
    cat "$KYROX_E2E_APP_LOG" >&2
    exit 1
  fi

  pnpm tsx scripts/local-smoke.ts
  PLAYWRIGHT_OUTPUT_DIR="$KYROX_E2E_BUILD_ROOT/../playwright-anvil" \
  KYROX_ANVIL_E2E=1 BASE_SEPOLIA_RPC_URL="$BASE_SEPOLIA_RPC_URL" \
    pnpm exec playwright test --config apps/web/playwright.config.ts --project=local-anvil
'

echo "✓ local API smoke and local-Anvil wallet Playwright suite passed"
