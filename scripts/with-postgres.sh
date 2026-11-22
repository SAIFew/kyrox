#!/usr/bin/env bash
# Provision a disposable PostgreSQL cluster in /tmp and run a command against it.
# Usage: with-postgres.sh <command> [args...]
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
WORK="$(mktemp -d /tmp/kyrox-pg.XXXXXX)"
DATA="$WORK/data"
LOG="$WORK/postgres.log"
PORT=$(( (RANDOM % 800) + 55432 ))
DB_USER="kyrox_test"
DB_NAME="kyrox_test"

cleanup() {
  if [ -f "$DATA/postmaster.pid" ]; then
    "$PG_BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

if [ ! -x "$PG_BIN/initdb" ]; then
  echo "PostgreSQL server binaries not found at $PG_BIN" >&2
  exit 1
fi

while nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

PW="$(openssl rand -hex 18)"
printf '%s' "$PW" > "$WORK/pw"

"$PG_BIN/initdb" -D "$DATA" -U postgres \
  --auth-local=trust --auth-host=scram-sha-256 \
  --pwfile="$WORK/pw" --encoding=UTF8 --locale=C >/dev/null
rm -f "$WORK/pw"

for attempt in 1 2 3 4 5; do
  if "$PG_BIN/pg_ctl" -D "$DATA" -l "$LOG" \
    -o "-p $PORT -h 127.0.0.1 -k $WORK -c listen_addresses=127.0.0.1" start >/dev/null 2>&1; then
    break
  fi
  PORT=$((PORT + 7))
  sleep 0.3
done
if [ ! -f "$DATA/postmaster.pid" ]; then
  echo "PostgreSQL failed to start; see $LOG" >&2
  cat "$LOG" >&2 || true
  exit 1
fi

export PGPASSWORD="$PW"
"$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$PW';" \
  -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" >/dev/null

VERSION="$("$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -Atc 'SHOW server_version;')"
echo "PostgreSQL $VERSION listening on 127.0.0.1:$PORT (temporary cluster)"

export KYROX_TEST_DATABASE_URL="postgres://$DB_USER:$PW@127.0.0.1:$PORT/$DB_NAME"
export DATABASE_URL="$KYROX_TEST_DATABASE_URL"
export DIRECT_DATABASE_URL="$KYROX_TEST_DATABASE_URL"

"$@"
