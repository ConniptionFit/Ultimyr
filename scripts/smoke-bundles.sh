#!/usr/bin/env bash
# Starts each built service bundle the way its container does (no tsx, production mode) and checks /healthz.
# Catches bundle problems that tests and typechecks cannot, for example a CommonJS dependency that fails to load.
# Run after `pnpm build`. Needs a Postgres reachable through DATABASE_URL (the services connect lazily).
set -u
export NODE_ENV=production PG_SSLMODE=disable
export DATABASE_URL="${DATABASE_URL:-${TEST_DATABASE_URL:-postgres://postgres:postgres@localhost:5432/ultimyr_test}}"
fail=0
port=4900
for svc in content quiz ai-gateway mcp notes; do
  port=$((port + 1))
  (cd "services/$svc" && PORT=$port FNS_URL= ULTIMYR_VAULT_KEK= node dist/main.js > "/tmp/smoke-$svc.log" 2>&1) &
  pid=$!
  ok=0
  for _ in $(seq 1 20); do
    sleep 0.5
    if curl -fsS "http://127.0.0.1:$port/healthz" > /dev/null 2>&1; then ok=1; break; fi
    kill -0 "$pid" 2> /dev/null || break
  done
  kill "$pid" 2> /dev/null
  wait "$pid" 2> /dev/null
  if [ "$ok" = 1 ]; then echo "ok    $svc"; else echo "FAIL  $svc"; head -n 12 "/tmp/smoke-$svc.log"; fail=1; fi
done

# The api container's launcher: migrations, then every service as its own process, reported by one health endpoint.
# Production mode needs the auth service's keys; throwaway ones are enough here.
keys="$(mktemp -d)"
openssl genpkey -algorithm ed25519 -out "$keys/jwt.pem" 2> /dev/null
openssl rand -base64 32 | tr -d '\n' > "$keys/secret"
export ULTIMYR_JWT_PRIVATE_KEY_FILE="$keys/jwt.pem" ULTIMYR_AUTH_ENC_KEY_FILE="$keys/secret" ULTIMYR_API_KEY_PEPPER_FILE="$keys/secret"
(cd apps/api && API_HEALTH_PORT=4990 ULTIMYR_ROOT="$PWD/../.." FNS_URL= ULTIMYR_VAULT_KEK= node dist/main.js > /tmp/smoke-api.log 2>&1) &
pid=$!
ok=0
for _ in $(seq 1 60); do
  sleep 0.5
  if curl -fsS "http://127.0.0.1:4990/healthz" > /dev/null 2>&1; then ok=1; break; fi
  kill -0 "$pid" 2> /dev/null || break
done
if [ "$ok" = 1 ]; then echo "ok    api (all services)"; else echo "FAIL  api"; head -n 30 /tmp/smoke-api.log; fail=1; fi
# The launcher stops its services on SIGTERM.
kill "$pid" 2> /dev/null
wait "$pid" 2> /dev/null
rm -rf "$keys"
exit $fail
