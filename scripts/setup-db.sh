#!/usr/bin/env sh
# One-time database setup on your existing Postgres container. It:
#   1. generates the secrets (secrets/pg_password and the rest; existing files are kept),
#   2. creates the "ultimyr" role and database on the Postgres container (deploy/postgres/setup.sql),
#   3. writes the connection settings and the password into .env (created from .env.example if missing),
#   4. prints the password so you can save it in a password manager.
# .env and secrets/ are both gitignored. Safe to run again: it re-applies the same password.
#
# Usage: ./scripts/setup-db.sh
# Overrides: PG_CONTAINER (default "postgres"), PG_ADMIN_USER (default "postgres", a superuser),
#            DB_NETWORK (default: the container's network, preferring "postgres_net").
set -eu
cd "$(dirname "$0")/.."
./scripts/init-secrets.sh > /dev/null
container="${PG_CONTAINER:-postgres}"
admin="${PG_ADMIN_USER:-postgres}"
pw="$(cat secrets/pg_password)"

if [ -z "${DB_NETWORK:-}" ]; then
  nets="$(docker inspect "$container" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}')"
  case " $nets" in
    *" postgres_net "*) DB_NETWORK=postgres_net ;;
    *) DB_NETWORK="${nets%% *}" ;;
  esac
fi

{ printf "\\\\set pw '%s'\\n" "$pw"; cat deploy/postgres/setup.sql; } \
  | docker exec -i "$container" psql -U "$admin" -v ON_ERROR_STOP=1 -q

# Set KEY=value in .env: replace the line if there is one, append otherwise.
[ -f .env ] || cp .env.example .env
setenv() {
  if grep -q "^$1=" .env; then
    awk -v k="$1" -v v="$2" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' .env > .env.tmp && mv .env.tmp .env
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}
setenv PG_HOST "$container"
setenv PG_USER ultimyr
setenv PG_DATABASE ultimyr
setenv DB_NETWORK "$DB_NETWORK"
# A copy for your records. The containers read the password from secrets/pg_password.
setenv PG_PASSWORD "$pw"
chmod 600 .env

cat <<MSG

Done. Ultimyr's database is ready on "$container" (network "$DB_NETWORK").

  Role / user:  ultimyr
  Database:     ultimyr
  Password:     $pw

Save that password in your password manager now. It is in .env and secrets/pg_password (both gitignored).
Next: docker compose up -d
MSG
