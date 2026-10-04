# ADR 0003: Nginx Proxy Manager by default, Traefik optional

**Status:** Accepted (Phase 1 follow-up)

## Context
The owner already runs Nginx Proxy Manager (NPM). NPM is configured through its UI, not Docker labels, and path-based routing and prefix stripping are fiddly there.

## Decision
- `docker-compose.yml` is proxy agnostic. A proxy is chosen with an overlay file listed in `COMPOSE_FILE`: `docker-compose.npm.yml` (default in `.env.example`) or `docker-compose.traefik.yml`.
- The NPM overlay starts no proxy. It joins the external network NPM uses (`PROXY_NETWORK`) with aliases `ultimyr-web` and `ultimyr-auth`.
- The web container is the single public upstream: Next.js rewrites `/api/v1/auth/*` and `/api/v1/me` to auth (`AUTH_URL`, a build arg because rewrites are fixed at build time). One NPM Proxy Host is enough.
- Services answer both `/v1/...` and `/api/v1/...`. Traefik and headless NPM setups can route `/api/v1/*` straight to auth without path rewriting.

## Consequences
- The web hop adds a little latency to API calls in NPM setups. Headless and Traefik setups skip it.
- Changing the auth service name or port requires rebuilding the web image with a new `AUTH_URL`.
