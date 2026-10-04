# Ultimyr

An AI-first learning and certification platform: study guides, flashcards and exam-accurate practice tests, behind a quiet, minimalist interface. Strictly non-monolithic and Docker-first.

**Status:** Phase 1 (platform skeleton and auth core). See [`docs/architecture-plan.md`](docs/architecture-plan.md) for the full plan and roadmap.

## What works today

- `web`: Next.js splash page, sign in, sign up, empty "Reading Room", and a settings page with a **themed names toggle**.
- `auth`: local accounts (argon2id), rotating refresh sessions with theft detection, EdDSA access tokens, JWKS endpoint, first-user admin bootstrap, audit log.
- `docker-compose.yml` with a bundled Postgres **or** your own external Postgres.
- Shared packages: `config`, `db` (migrations), `authz` (token verification), `lore` (naming and copy), `ui-icons` (Lucide helpers: spin, pulse, draw-on, bounce, status and composed icons).

## Run with Docker

```sh
cp .env.example .env
./scripts/init-secrets.sh
docker compose --profile bundled-db up -d --build    # bundled Postgres
# open http://localhost:8080 and create the first account (it becomes the admin)
```

**Use an existing Postgres instead:** set `DATABASE_URL` (or `PG_HOST`, `PG_USER`, `PG_DATABASE`, `PG_SSLMODE`) in `.env`, put its password in `secrets/pg_password`, and run `docker compose up -d --build` without the profile. Optional least-privilege roles: [`deploy/postgres/roles.sql`](deploy/postgres/roles.sql).

**Headless (API only):** `docker compose up -d traefik auth`.

## Develop locally

Requires Node 22 and pnpm 9.

```sh
pnpm install
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/ultimyr
export TEST_DATABASE_URL=$DATABASE_URL     # enables the auth integration tests
pnpm migrate                               # applies service migrations
pnpm dev:auth                              # http://localhost:4001
pnpm dev:web                               # http://localhost:3000 (proxies /api/v1 to auth)
pnpm typecheck && pnpm test
```

## Layout

```
apps/web              Next.js UI
services/auth         Auth service (Fastify + Drizzle), owns the `auth` schema
packages/config       Env parsing, Docker secrets (_FILE), database config
packages/db           Pool and SQL migration runner
packages/authz        Roles and token verification (shared by every service)
packages/lore         Themed and plain names, micro-copy
packages/ui-icons     Lucide icon utilities and animations
docs/                 Architecture plan and ADRs
```

## Public API (Phase 1)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/auth/register` | First account becomes platform admin |
| POST | `/api/v1/auth/login` | Rate limited, identical error for unknown user and wrong password |
| POST | `/api/v1/auth/refresh` | Rotates the httpOnly refresh cookie |
| POST | `/api/v1/auth/logout` | Revokes the session |
| GET | `/api/v1/me` | Bearer access token |
| GET | `/.well-known/jwks.json` | Public signing key |
