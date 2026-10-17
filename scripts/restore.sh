#!/usr/bin/env sh
# Restore a dump made by scripts/backup.sh into the ultimyr database on your Postgres container.
# Usage: scripts/restore.sh backups/<timestamp>/ultimyr.dump
# Put the matching ./secrets back first. This replaces existing data in that database only.
set -eu
dump="${1:?path to ultimyr.dump}"
[ -f "$dump" ] || { echo "No such file: $dump" >&2; exit 1; }
[ -f .env ] && { set -a; . ./.env; set +a; }
container="${PG_CONTAINER:-${PG_HOST:-postgres}}"
user="${PG_USER:-ultimyr}"
db="${PG_DATABASE:-ultimyr}"
printf 'This replaces all data in the "%s" database. Type "restore" to continue: ' "$db"
read -r answer
[ "$answer" = "restore" ] || { echo "Cancelled."; exit 1; }
docker compose stop api web 2>/dev/null || true
docker exec -i -e PGPASSWORD="$(cat secrets/pg_password)" "$container" pg_restore -U "$user" -d "$db" --clean --if-exists --no-owner < "$dump"
docker compose up -d
echo "Restore complete."
