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
# The bundled database only runs with its profile. If .env points at the host "postgres" (the bundled one),
# keep it in the update, otherwise services fail with "getaddrinfo ENOTFOUND postgres".
PROFILE=()
if grep -Eq '^PG_HOST=postgres[[:space:]]*$' .env 2>/dev/null || docker compose ps -a --services 2>/dev/null | grep -qx postgres; then
  PROFILE=(--profile bundled-db)
fi
docker compose "${PROFILE[@]}" up -d --build

echo "Waiting for services to report healthy..."
for _ in $(seq 1 40); do
  if [ -z "$(docker compose ps --format '{{.Name}} {{.Health}}' | grep -E 'starting|unhealthy' || true)" ]; then break; fi
  sleep 3
done
echo "Version: $(git log -1 --oneline)"
docker compose "${PROFILE[@]}" ps --format 'table {{.Name}}\t{{.Status}}'
