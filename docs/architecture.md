# Architecture (as built)

The approved plan is [architecture-plan.md](architecture-plan.md). This page covers what exists today. Rationale lives in the [ADRs](adr).

## Shape
```
Browser ──► reverse proxy (Nginx Proxy Manager or Traefik, TLS)
              │
              ├─► web container: Next.js :3000 ── rewrites /api/v1/*, /scim/v2, JWKS ──┐
              └─► api container (launcher :4000 for health) ◄──────────────────────────┘
                    ├─ auth (Fastify, :4001)  ◄── every service verifies tokens via its JWKS
                    ├─ content (Fastify, :4002)
                    ├─ quiz (Fastify, :4003) ── asks content who may attempt/edit
                    ├─ ai-gateway (Fastify, :4004) ── writes drafts to content/quiz with the caller's token
                    │     key vault in schema `ai`; calls Gemini, OpenAI or Anthropic over https
                    ├─ mcp (Fastify, :4005, /mcp) ── calls content and quiz as the caller
                    └─ notes (Fastify, :4006) ── bridge to Fast Note Sync
                          │
                          └─► your Postgres container (database `ultimyr`; schemas `auth`, `content`, `quiz`, `ai`, `notes`)
```
Two containers, six services. The services are still separate packages with separate routes, tables and tests; they only meet at three places: HTTP between each other (on loopback inside the api container, exactly as they did between containers), the shared packages (`authz`, `config`, `db`, `service-kit`) and the database (one schema each). A service never imports another service. See [ADR 0019](adr/0019-two-containers.md).

- **web** renders the UI. It holds no secrets and no database access. It forwards API calls to the api container, so one proxy host is enough. Proxies that can route by path (Traefik) send `/api/v1/*` straight to the right service port.
- **api** (`apps/api`) is a small launcher, not a framework. At start it waits for Postgres, applies every service's migrations, then runs each service as its own Node process and restarts any that exits (with a growing delay), so one service crashing or leaking memory does not stop the others. Output is prefixed with the service name. `GET :4000/healthz` returns 200 when every service answers, otherwise 503 with each service's state; Docker's health check and the web container use it.
- **auth** owns users, sessions, MFA, passkeys, API keys, groups, identity providers, SCIM and the audit log. It is the only writer of the `auth` schema.
- **content** owns archives, guides, decks, versions, grants and search (see [content.md](content.md)), and each person's flashcard review schedule (see [study.md](study.md); scheduling by the pure `@ultimyr/fsrs` package). It verifies access tokens with auth's JWKS, so a revoked session keeps working there until its 10 minute token expires.
- **quiz** owns questions, quiz settings, scoring profiles and attempts (see [quiz.md](quiz.md)). It never copies sharing data: for each request it asks content what the caller may do with the quiz item, using the caller's own token. Grading uses the pure `@ultimyr/scoring` package. It also serves progress analytics and goals, computed from attempts on demand, and a server-sent clock for open attempts.
- **ai-gateway** holds each person's AI keys in an envelope-encrypted vault and runs generation jobs and the study assistant (see [ai.md](ai.md), [ADR 0008](adr/0008-ai-gateway.md)). It never gives a key back, and it writes generated content as drafts using the caller's own token.
- **mcp** exposes the platform to Claude and other MCP apps over stateless Streamable HTTP (see [mcp.md](mcp.md), [ADR 0009](adr/0009-mcp-and-oauth.md)). It has no database: it verifies the caller's token, then calls content and quiz with that same token. OAuth for MCP apps (client registration, consent, tokens, connections) is part of **auth**.
- Every service owns one schema and verifies tokens with `@ultimyr/authz` and the JWKS endpoint, never by calling auth per request. The only per-user call is the content service fetching group memberships (cached 30 seconds). Migrations run in the api launcher once before any service starts (each service keeps its own directory and its own tracked history). Nothing else is planned as a separate service.

## Tokens and sessions
1. Login (password, MFA, passkey or SSO) creates a `sessions` row and sets the refresh cookie `ultimyr_rt` (httpOnly, SameSite=Lax, path `/api/v1/auth`, 30 days).
2. The web app calls `/auth/refresh` on load to get a 10 minute EdDSA access token, kept in memory only. It renews the token a minute before it expires (and when a sleeping tab wakes up), and an API call that still gets a 401 renews once and retries.
3. Refresh rotates the cookie. A reused (stolen) cookie revokes the whole session, except for a 10 second grace window after a rotation so two tabs refreshing at once do not sign you out.
4. Connected apps (MCP) sign in with OAuth and get a 30 minute token (session id `mcp:<connection>`) limited to the scopes the person approved, plus a rotating refresh token. They cannot change account security.
5. API keys (`ulk_<prefix>_<secret>`) are exchanged at `/auth/token` for a 10 minute token carrying only the key's scopes. Their session id starts with `key:`, and account-management routes refuse them.
6. Other services verify the JWT signature, issuer, audience and expiry, then check roles and scopes.

## Data
- Postgres only. One schema per service. Migrations are hand written, forward only, checksummed, applied under an advisory lock (so two replicas cannot race). Editing an applied migration fails the run on purpose.
- Encrypted at rest: TOTP seeds and IdP client secrets (AES-256-GCM with per-row associated data). Hashed: passwords (argon2id), API keys and SCIM tokens (HMAC with the pepper), refresh tokens (SHA-256).
- Audit events are rows in `auth.audit_log`, written by the service and read through the admin API.

## Packages
| Package | Role |
|---|---|
| `@ultimyr/config` | Env parsing, `_FILE` secrets, database config |
| `@ultimyr/db` | Pool and migration runner (`pnpm migrate`) |
| `@ultimyr/service-kit` | Fastify setup shared by every service: error format, health routes, token verification, scope checks, `/api` double mounting, transactions, test token issuer |
| `@ultimyr/authz` | Roles, scopes, token claims and verification. Shared by every service |
| `@ultimyr/lore` | Themed and plain names and micro-copy |
| `@ultimyr/ui-icons` | Lucide helpers and animations |

## Themed names
Every Archive-flavored label has a plain equivalent. The user's choice is stored in the `ultimyr_naming` cookie (default plain; users opt in to themed) and only changes UI text. APIs, MCP tools and exports always use plain names. Themed names follow Dota 2 lore ([naming.md](naming.md)). See [ADR 0002](adr/0002-themed-names-toggle.md).

## Images
One Dockerfile with two targets, `api` and `web`, published as `ultimyr-api` and `ultimyr-web`. CI builds both on every pull request.
