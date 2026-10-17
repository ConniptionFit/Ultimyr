#!/usr/bin/env bash
# Update an Ultimyr install in one step: ./scripts/update.sh
# Pulls the prebuilt images CI publishes (fast, nothing compiles on your server). If they cannot be
# pulled (a fork, or a commit CI has not finished building), it builds from source instead.
# Force a source build with: ULTIMYR_BUILD=1 ./scripts/update.sh
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
if [ "${ULTIMYR_BUILD:-0}" = 1 ]; then
  docker compose "${PROFILE[@]}" up -d --build
elif docker compose "${PROFILE[@]}" pull --quiet; then
  docker compose "${PROFILE[@]}" up -d --remove-orphans
else
  echo "Could not pull the prebuilt images; building from source instead."
  docker compose "${PROFILE[@]}" up -d --build
fi
docker image prune -f >/dev/null 2>&1 || true

echo "Waiting for services to report healthy..."
for _ in $(seq 1 40); do
  if [ -z "$(docker compose ps --format '{{.Name}} {{.Health}}' | grep -E 'starting|unhealthy' || true)" ]; then break; fi
  sleep 3
done
echo "Version: $(git log -1 --oneline)"
docker compose "${PROFILE[@]}" ps --format 'table {{.Name}}\t{{.Status}}'
