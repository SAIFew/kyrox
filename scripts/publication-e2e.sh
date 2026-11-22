#!/usr/bin/env bash
# Local publication rehearsal: temporary PostgreSQL + temporary Anvil.
set -euo pipefail
exec "$(dirname "$0")/with-postgres.sh" \
  env KYROX_PUBLICATION_E2E=1 \
  pnpm vitest run services/price/test/publication.e2e.test.ts
