# ADR 0019: Two containers, modular code, your own Postgres

**Status:** Accepted

## Context
Ultimyr ran nine containers (web, auth, content, quiz, ai-gateway, notes, mcp, a one-shot migrate job and an optional Postgres). On a homelab that shares one Postgres between many apps, that is clutter: more to update, monitor and keep healthy, and a second database server nobody asked for. The services themselves are not the problem. They are separate packages that already meet only over HTTP, through four small shared packages and a schema each. Keeping that is what stops a change in one feature from breaking another.

## Decisions
- **Two containers.** `web` (Next.js) and `api` (auth, content, quiz, AI gateway, notes, MCP). Published as `ultimyr-web` and `ultimyr-api`.
- **The code stays modular; only the packaging changes.** Each service keeps its own package, routes, migrations and tests, and a service never imports another service. Services reach each other over HTTP on loopback with the same JWKS and token checks as before. Nothing in a service knows what container it is in.
- **A launcher, not a merged server.** `apps/api` waits for the database, applies every service's migrations, then runs each service's own bundle as a separate Node process and restarts any that exits (1 second, doubling to 30). One service crashing, running out of memory or failing to start does not stop the others. The alternative, mounting all six apps on one Fastify instance, would have needed route-prefix and config changes in every service and made one uncaught error stop everything.
- **Migrations run in the launcher**, once, before any service starts, replacing the `migrate` job. The tracking table, advisory lock and per-service directories are unchanged.
- **Your Postgres.** No database is bundled by default. A dedicated `ultimyr` role owns an `ultimyr` database on the shared server (`deploy/postgres/setup.sql`) and each service keeps its tables in its own schema inside it. The api container joins the Postgres container's Docker network (`DB_NETWORK`). `docker-compose.bundled-db.yml` remains for a machine with no Postgres.
- **Guard rails for the boundaries.** `apps/api` lists the union of the services' third-party dependencies, and a test fails if a service adds one the api package does not carry at the same version. Every PR still builds and tests each service on its own, and CI starts the launcher against a real database.

## Consequences
- Fewer things to run and pull: two images instead of eight, one health check for the whole backend.
- Services share a container's CPU, memory and filesystem, and the api container holds every backend secret (JWT key, auth keys, vault key). Each process receives only its own settings, but they are one trust domain at the container level. The vault key and the auth keys were already separate files mounted per container; now they are mounted together.
- Resource limits and restarts apply to the api container as a whole. Restarting one service is `docker compose restart api` (all) or sending that process a signal; per-service Docker restarts are gone, replaced by the launcher's.
- One-way for image names: `ultimyr-auth`, `-content`, `-quiz`, `-ai-gateway`, `-notes`, `-mcp` and `-migrate` are no longer built. Existing installs follow [Moving to two containers](../operations.md#moving-to-two-containers).
