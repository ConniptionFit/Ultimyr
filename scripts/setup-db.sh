#!/usr/bin/env sh
# One-time database setup on your existing Postgres container: creates the "ultimyr" role and database
# (deploy/postgres/setup.sql) with the password in secrets/pg_password, and prints that password so you can
# save it in a password manager. Safe to run again: it re-applies the same password to the role.
#
# Usage: ./scripts/setup-db.sh
# Overrides: PG_CONTAINER (default "postgres"), PG_ADMIN_USER (default "postgres"; a superuser).
set -eu
cd "$(dirname "$0")/.."
./scripts/init-secrets.sh > /dev/null
container="${PG_CONTAINER:-postgres}"
admin="${PG_ADMIN_USER:-postgres}"
pw="$(cat secrets/pg_password)"

{ printf "\\\\set pw '%s'\\n" "$pw"; cat deploy/postgres/setup.sql; } \
  | docker exec -i "$container" psql -U "$admin" -v ON_ERROR_STOP=1 -q

cat <<MSG

Done. Ultimyr's database is ready on "$container".

  Role / user:  ultimyr
  Database:     ultimyr
  Password:     $pw

Save that password in your password manager now. It is also in secrets/pg_password, which Ultimyr reads.
Next: set DB_NETWORK and PG_HOST in .env, then run: docker compose up -d
MSG
