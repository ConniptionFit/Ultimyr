# ADR 0001: TypeScript monorepo, one schema per service

**Status:** Accepted (Phase 0)

## Context
Ultimyr must be strictly non-monolithic, deployable with Docker, usable headless (API and MCP only), and able to share validation and scoring logic between services and UI.

## Decision
- One pnpm workspace in TypeScript. Deployables live in `services/` and `apps/`, shared code in `packages/`.
- Each service owns one Postgres schema (`auth`, later `content`, `quiz`, `ai`). No cross-schema joins; services talk over REST and, later, an outbox.
- Fastify for services, Drizzle for queries, hand-written forward-only SQL migrations (checksummed) so DBAs can read exactly what runs.
- Shared packages are consumed as TypeScript source and bundled into each image with tsup (`noExternal: @ultimyr/*`). Runtime dependencies are installed with `pnpm deploy --prod`.
- Services verify EdDSA access tokens locally against the auth JWKS. Refresh tokens rotate and a replayed token revokes the session.

## Consequences
- Adding a service means a new directory, a migrations folder and a Dockerfile target. Nothing else is rebuilt.
- Public URLs are `/api/v1/...`. Services answer both `/v1/...` and `/api/v1/...`, so proxies never rewrite paths (see ADR 0003).
- Phase 1 ships `auth` and `web` only. `content`, `quiz`, `ai-gateway`, `mcp` and `worker` follow the roadmap in `docs/architecture-plan.md`.
