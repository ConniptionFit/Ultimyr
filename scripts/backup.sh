#!/usr/bin/env sh
# Back up the Ultimyr database and the secrets folder into ./backups/<timestamp>/.
# The database is dumped through your Postgres container (default name "postgres", override with PG_CONTAINER).
# Usage: scripts/backup.sh [output-dir]
set -eu
[ -f .env ] && { set -a; . ./.env; set +a; }
container="${PG_CONTAINER:-${PG_HOST:-postgres}}"
user="${PG_USER:-ultimyr}"
db="${PG_DATABASE:-ultimyr}"
out="${1:-backups}/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$out"
docker exec -e PGPASSWORD="$(cat secrets/pg_password)" "$container" pg_dump -U "$user" -d "$db" --format=custom > "$out/ultimyr.dump"
# Secrets are archived separately and should be stored apart from the dump.
tar -C . -czf "$out/secrets.tgz" secrets
chmod 600 "$out"/*
echo "Backup written to $out"
echo "Store secrets.tgz somewhere other than the database dump."
