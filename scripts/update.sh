#!/usr/bin/env bash
# Update an Ultimyr install in one step: ./scripts/update.sh
# Local edits to tracked files (for example an old hand-made tsup.config.ts fix) are saved to a
# stash first, so `git pull` can never be blocked by them.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Saving your local edits to a git stash (restore later with: git stash pop)"
  git stash push -m "ultimyr-update-$(date +%Y%m%d-%H%M%S)" >/dev/null
fi

git pull --ff-only
./scripts/init-secrets.sh
# The bundled database runs only when you ask for it: set COMPOSE_PROFILES=bundled-db in .env (or pass --profile).
# This script never turns it on by itself, because starting it against an existing install would create an empty database
# next to your real one. If your data lives in another Postgres, point PG_HOST / DATABASE_URL at it instead.
PROFILE=()
if [ "${ULTIMYR_BUNDLED_DB:-}" = "true" ]; then PROFILE=(--profile bundled-db); fi
if grep -Eq '^PG_HOST=postgres[[:space:]]*$' .env 2>/dev/null && [ -z "${COMPOSE_PROFILES:-}" ] && ! grep -q '^COMPOSE_PROFILES=.*bundled-db' .env 2>/dev/null && [ "${ULTIMYR_BUNDLED_DB:-}" != "true" ]; then
  echo "Note: .env uses PG_HOST=postgres. If that is an external Postgres on a shared Docker network, make sure it is running and reachable."
  echo "      If you use the bundled database, run: ULTIMYR_BUNDLED_DB=true ./scripts/update.sh"
fi
docker compose "${PROFILE[@]}" up -d --build

echo "Waiting for services to report healthy..."
for _ in $(seq 1 40); do
  if [ -z "$(docker compose ps --format '{{.Name}} {{.Health}}' | grep -E 'starting|unhealthy' || true)" ]; then break; fi
  sleep 3
done
echo "Version: $(git log -1 --oneline)"
docker compose "${PROFILE[@]}" ps --format 'table {{.Name}}\t{{.Status}}'
