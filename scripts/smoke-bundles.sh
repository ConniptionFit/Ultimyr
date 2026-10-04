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
exit $fail
