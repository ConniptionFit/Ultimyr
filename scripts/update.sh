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
# Version 1.x ran six service containers and a bundled Postgres. Replacing them removes the old containers, so make sure
# the data has been moved to your own Postgres first (docs/operations.md, "Moving to two containers").
if docker ps -a --filter label=com.docker.compose.project=ultimyr --filter label=com.docker.compose.service=postgres -q 2>/dev/null | grep -q . \
   && ! printf '%s' "${COMPOSE_FILE:-}$(grep -s '^COMPOSE_FILE=' .env)" | grep -q bundled-db; then
  echo "A bundled Postgres container from the old layout still exists, and COMPOSE_FILE does not include docker-compose.bundled-db.yml."
  echo "Moving its data to your own Postgres is described in docs/operations.md (\"Moving to two containers\")."
  echo "To keep using the bundled database instead, add :docker-compose.bundled-db.yml to COMPOSE_FILE in .env and run this again."
  exit 1
fi
if [ "${ULTIMYR_BUILD:-0}" = 1 ]; then
  docker compose up -d --build --remove-orphans
elif docker compose pull --quiet; then
  docker compose up -d --remove-orphans
else
  echo "Could not pull the prebuilt images; building from source instead."
  docker compose up -d --build --remove-orphans
fi
docker image prune -f >/dev/null 2>&1 || true

echo "Waiting for services to report healthy..."
for _ in $(seq 1 40); do
  if [ -z "$(docker compose ps --format '{{.Name}} {{.Health}}' | grep -E 'starting|unhealthy' || true)" ]; then break; fi
  sleep 3
done
echo "Version: $(git log -1 --oneline)"
docker compose ps --format 'table {{.Name}}\t{{.Status}}'
