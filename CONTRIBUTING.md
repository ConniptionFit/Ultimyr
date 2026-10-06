# Contributing

## Setup
Node 22, pnpm 9, and a local Postgres 16 for the auth tests. See "Develop locally" in the [README](README.md).

```sh
pnpm install
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/ultimyr_test   # throwaway DB
pnpm typecheck && pnpm test && pnpm build
```
CI runs the same, then builds the Docker images and validates every compose combination. Without `TEST_DATABASE_URL` the auth integration tests are skipped, so set it before opening a PR.

## Conventions
- **Services are separate.** Each owns its Postgres schema and never reads another's tables. Share code through `packages/*`, not by importing across services.
- **Migrations** are forward-only SQL in `services/<name>/migrations`, named `NNNN_description.sql`. Never edit one that has shipped; add a new one.
- **Plain names in APIs.** Themed (Archive) names appear only as UI labels, and each needs a plain equivalent in `packages/lore`.
- **Themed names follow Dota 2 lore.** Every new themed name must come from researched Dota 2 lore and make the element's function obvious, with its source recorded in `termLore`. Follow [docs/naming.md](docs/naming.md); do not invent names.
- **No new secrets in code or env defaults.** Production secrets come from Docker secrets (`_FILE`).
- **Security-sensitive changes** (auth, crypto, SSO, SCIM) need tests for the failure cases, not just the happy path. See `services/auth/test`.
- Decisions that change the design get an ADR in `docs/adr`.
- Keep docs current: update [`docs/`](docs/README.md) and `.env.example` in the same PR as the change.

## Pull requests
Branch from `main`, keep PRs focused, describe before and after, and note what you did not test.
