#!/usr/bin/env sh
# Back up the bundled Postgres and the secrets folder into ./backups/<timestamp>/.
# Usage: scripts/backup.sh [output-dir]
set -eu
out="${1:-backups}/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$out"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$out/ultimyr.dump"
# Secrets are archived separately and should be stored apart from the dump.
tar -C . -czf "$out/secrets.tgz" secrets
chmod 600 "$out"/*
echo "Backup written to $out"
echo "Store secrets.tgz somewhere other than the database dump."
