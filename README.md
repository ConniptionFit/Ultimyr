# Ultimyr

An AI-first learning and certification platform: study guides, flashcards and exam-accurate practice tests, behind a quiet, minimalist interface. Strictly non-monolithic and Docker-first.

**Status:** Phase 2 (identity hardening). Phase 1 is the skeleton and auth core. See [`docs/architecture-plan.md`](docs/architecture-plan.md) for the full plan and roadmap.

## What works today

- `web`: Next.js splash page, sign in, sign up, empty "Reading Room", and a settings page with a **themed names toggle**.
- `auth`: local accounts (argon2id), rotating refresh sessions with theft detection, EdDSA access tokens, JWKS endpoint, first-user admin bootstrap, audit log.
- Phase 2 identity: TOTP and recovery codes, passkeys, API keys, OIDC/OAuth2/SAML sign-in, SCIM 2.0, groups, admin API. See [`docs/identity.md`](docs/identity.md).
- Docker Compose with a bundled Postgres **or** your own external Postgres, and a choice of Nginx Proxy Manager (default) or Traefik.
- Shared packages: `config`, `db` (migrations), `authz` (token verification), `lore` (naming and copy), `ui-icons` (Lucide helpers: spin, pulse, draw-on, bounce, status and composed icons).

## Run with Docker

```sh
cp .env.example .env            # defaults to the Nginx Proxy Manager overlay
./scripts/init-secrets.sh
docker compose --profile bundled-db up -d --build    # bundled Postgres
```

Set `ULTIMYR_PUBLIC_URL` in `.env` to the address you browse to (needed for passkeys and SSO). The first account you create becomes the admin. Ultimyr needs a reverse proxy for HTTPS and a hostname. Pick one with `COMPOSE_FILE` in `.env`:

| Proxy | `COMPOSE_FILE` | Notes |
|---|---|---|
| **Nginx Proxy Manager** (default) | `docker-compose.yml:docker-compose.npm.yml` | Ultimyr joins the Docker network NPM is on (`PROXY_NETWORK`, default `proxy`). No proxy container is started. |
| Traefik | `docker-compose.yml:docker-compose.traefik.yml` | Starts a bundled Traefik on `ULTIMYR_HTTP_PORT` (default 8080). |
| None | `docker-compose.yml` | Only publishes web on `ULTIMYR_BIND:ULTIMYR_WEB_PORT` (default `127.0.0.1:3000`). |

### Nginx Proxy Manager setup (default)

1. Put NPM and Ultimyr on one network. If you have no shared network yet: `docker network create proxy && docker network connect proxy <your-npm-container>`. If NPM already uses a network, set `PROXY_NETWORK` to its name.
2. `docker compose up -d --build` (add `--profile bundled-db` for the bundled database).
3. In NPM, add a **Proxy Host**: your domain, scheme `http`, forward host `ultimyr-web`, port `3000`, enable **Websockets Support** and **Block Common Exploits**, then request an SSL certificate.
4. Set `COOKIE_SECURE=true` in `.env` and run `docker compose up -d` again.

That is the whole setup: the web container forwards `/api/v1/*` to the auth service itself, so you need no custom locations. NPM on a different host? Use the published port instead: forward to `<docker-host-ip>:3000` and set `ULTIMYR_BIND=0.0.0.0` (keep it firewalled to NPM).

**Headless (API and MCP only):** `docker compose up -d auth`. In NPM, create a Proxy Host forwarding to `ultimyr-auth:4001`. Auth answers both `/v1/...` and `/api/v1/...`, so no path rewriting is needed.

### Traefik setup

Set `COMPOSE_FILE=docker-compose.yml:docker-compose.traefik.yml`, run `docker compose up -d --build`, and open `http://localhost:8080`. Routes are defined by labels in the overlay: `/api/v1/auth`, `/api/v1/me`, `/api/v1/admin`, `/scim/v2` and `/.well-known` go to auth, everything else to web. Add your own TLS entrypoint or certificate resolver flags to the `traefik` command for HTTPS.

### Use an existing Postgres

Set `DATABASE_URL` (or `PG_HOST`, `PG_USER`, `PG_DATABASE`, `PG_SSLMODE`) in `.env`, put its password in `secrets/pg_password`, and run `docker compose up -d --build` without the `bundled-db` profile. Optional least-privilege roles: [`deploy/postgres/roles.sql`](deploy/postgres/roles.sql).

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
docs/                 Guides, API reference, architecture plan and ADRs
```

## Documentation

Start at [`docs/README.md`](docs/README.md): [configuration](docs/configuration.md), [identity setup](docs/identity.md), [API reference](docs/api.md), [architecture](docs/architecture.md), [operations](docs/operations.md). Also [CONTRIBUTING](CONTRIBUTING.md) and [SECURITY](SECURITY.md).

## API at a glance

Everything is under `/api/v1`. The full list, with auth rules, is in [`docs/api.md`](docs/api.md).

| Area | Paths |
|---|---|
| Sign in | `/auth/register`, `/auth/login`, `/auth/mfa/verify`, `/auth/refresh`, `/auth/logout`, `/auth/passkeys/login/*`, `/auth/sso/*`, `/auth/saml/*`, `/auth/token` |
| Account | `/me`, `/me/mfa`, `/me/passkeys`, `/me/api-keys`, `/me/sessions`, `/me/groups`, `/me/identities` |
| Admin | `/admin/users`, `/admin/groups`, `/admin/idp-providers`, `/admin/scim-tokens`, `/admin/audit` |
| Provisioning | `/scim/v2` (SCIM 2.0, no `/api/v1` prefix) |
| Keys and health | `/.well-known/jwks.json`, `/healthz`, `/readyz` |

## License

[MIT](LICENSE).
