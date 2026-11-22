#!/usr/bin/env bash
set -euo pipefail
exec "$(dirname "$0")/with-postgres.sh" pnpm test:postgres
