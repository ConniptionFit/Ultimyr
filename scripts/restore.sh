#!/usr/bin/env sh
# Restore a dump made by scripts/backup.sh into the bundled Postgres.
# Usage: scripts/restore.sh backups/<timestamp>/ultimyr.dump
# Put the matching ./secrets back first. This replaces existing data.
set -eu
dump="${1:?path to ultimyr.dump}"
[ -f "$dump" ] || { echo "No such file: $dump" >&2; exit 1; }
printf 'This replaces all data in the database. Type "restore" to continue: '
read -r answer
[ "$answer" = "restore" ] || { echo "Cancelled."; exit 1; }
docker compose stop auth content quiz ai-gateway mcp web 2>/dev/null || true
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < "$dump"
docker compose up -d
echo "Restore complete."
