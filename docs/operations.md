# Operations

## First run
1. `cp .env.example .env`, set `ULTIMYR_PUBLIC_URL`, pick a proxy overlay.
2. `./scripts/init-secrets.sh`
3. Create the `ultimyr` role and database on your Postgres once (`deploy/postgres/setup.sql`, see the README), then `docker compose up -d`. The api container applies the migrations.
4. Open the site and register. The first account is the platform admin. Then consider `AUTH_REGISTRATION=closed`.
5. Set `COOKIE_SECURE=true` once HTTPS works.

## Health
- `GET :4000/healthz` on the api container returns 200 when all six services answer, otherwise 503 with each service's state and restart count. The api container has a Docker healthcheck on it, and web waits for it. Each service also has its own `/healthz` and `/readyz` on its port (auth 4001 and so on).
- `docker compose ps` and `docker compose logs -f api`. Every line is prefixed with its service, for example `docker compose logs -f api | grep '^api-1.*\[quiz\]'`.
- Failed sign-ins, MFA events, key use and admin changes are in the audit log (`GET /api/v1/admin/audit`).

## Services
`auth`, `content`, `quiz`, `ai-gateway`, `notes` and `mcp` each have `/healthz` and `/readyz`, and run as separate processes inside the api container. If one exits, the launcher restarts it after 1 second, doubling the wait up to 30 seconds, and logs `[supervisor] <service> exited`; the others keep serving. Quiz needs content to authorise requests: while content is unreachable, quiz answers 503 (attempts already in progress are not lost, and their clocks keep running). Content starts without auth, but until auth is reachable it cannot verify new tokens. The AI gateway needs auth, content and quiz to be reachable to verify tokens and save drafts. It starts without a vault key, with AI features answering 503. Deleted archives and items are purged after 30 days by a job inside the content service (every 6 hours).

## Backups
Back up two things:
- **Postgres**: the `ultimyr` database. `./scripts/backup.sh` dumps it through your Postgres container (`PG_CONTAINER`, default the `PG_HOST` name), or use your server's usual method, for example `pg_dump -Fc ultimyr`.
- **`./secrets`**: especially `auth_enc_key`, `vault_kek` and `jwt_private_key.pem`. A database backup without `auth_enc_key` cannot restore TOTP or IdP secrets, and one without `vault_kek` cannot restore AI keys. Store them separately from the dump.

Or use the scripts, which wrap the commands above:
```sh
scripts/backup.sh                                  # writes backups/<timestamp>/ultimyr.dump and secrets.tgz
scripts/restore.sh backups/<timestamp>/ultimyr.dump   # asks you to type "restore", stops the app, loads the dump, starts it again
```
Restore: put the same secrets back first, then run the restore script. Practise on a copy before you need it. A good routine is a nightly `scripts/backup.sh` from cron, keeping `secrets.tgz` somewhere separate.

## Load check
`node scripts/loadtest.mjs https://your.address 30 20` runs 20 parallel clients for 30 seconds against public, read-only pages and prints requests per second, p50, p95, p99 and errors. On a small shared CPU (production build, bundled Postgres) it served about 390 requests per second with p95 near 110 ms and no errors. Treat it as a smoke test, not a capacity plan.

## Runbooks
| Situation | Do this |
|---|---|
| Site is down | `docker compose ps`, then `docker compose logs --tail=100 <service>`. Each service has `/healthz` (alive) and `/readyz` (database reachable). |
| A bad release | Take a backup, `git checkout <previous tag>`, `docker compose up -d --build`. Migrations are forward only, so restoring the pre-upgrade backup is the safe way back across a migration. |
| Suspected leaked secret | Rotate it per the table below. A leaked `jwt_private_key.pem` also needs everyone signed out (rotating does that). Revoke API keys and MCP connections from Settings or the admin API. |
| Person leaves | Deactivate them (admin or SCIM), then `DELETE /v1/ai/me` as an admin if their AI keys should be destroyed. |
| Disk filling | Check the `pgdata` volume and Docker logs (`docker system df`). Set log rotation in Docker's `daemon.json`. |

## Upgrading
CI builds every service on each merge to `main` and on each release tag (`v*`) and publishes the images to the Forgejo container registry at `git.pwrs.dev/powers/ultimyr-<api|web>` (the default) and to GitHub's (`ghcr.io/conniptionfit/ultimyr-<api|web>`, amd64 and arm64). The Forgejo images are built by `.forgejo/workflows/image.yml` for the Docker host's own architecture. Nothing compiles on your server. One step: `./scripts/update.sh` (saves local edits to a git stash so `git pull` is never blocked, pulls the repo files, adds new secrets, pulls the images, restarts what changed, waits for health and prints the version). Or by hand:
```sh
git pull                          # only needed when docker-compose.yml, .env.example or scripts changed
./scripts/init-secrets.sh        # adds any new secret files, keeps existing ones
docker compose pull && docker compose up -d
```
If you only want the newest app and never touch the compose files, `docker compose pull && docker compose up -d` is enough.

| Want | How |
|---|---|
| Newest build | `ULTIMYR_TAG=latest` (default) |
| A release | `ULTIMYR_TAG=v1.2.0` in `.env` (`1.2` and `1` also work) |
| Roll back | `ULTIMYR_TAG=sha-<7 chars>` of an earlier commit (Admin > About shows the running commit), then `docker compose pull && docker compose up -d`. Check [ROLLBACK.md](ROLLBACK.md) first when the newer version added migrations. |
| Build from source | `ULTIMYR_BUILD=1 ./scripts/update.sh`, or `docker compose up -d --build` |
| A fork or other registry | `ULTIMYR_REGISTRY=ghcr.io/conniptionfit` (GitHub images) or `ghcr.io/<you>` in `.env`. The default is `git.pwrs.dev/powers`. |
| Automatic | Every service carries the label `com.centurylinklabs.watchtower.enable=true`, so Watchtower (label-enable mode), Komodo and similar tools update the stack on their own. |

**First time only (maintainer, Forgejo):** the repo is public, so its packages are too. In the repo's Actions settings add the secret `REGISTRY_TOKEN` (an access token with `write:package`, only needed if the built-in token cannot push), and either a runner with Docker or the `DOCKER_SSH_KEY` secret and `DOCKER_SSH_HOST` variable (see the header of `.forgejo/workflows/image.yml`). Run the workflow once from the Actions tab. The source of truth is `https://git.pwrs.dev/powers/ultimyr`.

**GitHub images (optional):** GitHub creates each package as private. After the first CI publish, open each `ultimyr-*` package under the account's Packages and set its visibility to Public (or run `docker login ghcr.io` with a token on the server). To also push to a self-hosted registry such as Forgejo, add the repo secret `REGISTRY_TOKEN` and the variables `MIRROR_REGISTRY` (for example `git.pwrs.dev/powers`) and `MIRROR_USER`.

**Releasing:** bump `version` in the root `package.json`, merge, then `git tag v1.2.0 && git push origin v1.2.0`. The tag build is stamped with that version, which Admin > About compares with the latest GitHub release.

The api container applies new migrations once at start, before any service runs. Migrations are forward only. Take a backup before upgrading across phases. If a migration fails, the api container logs `[migrate] ...` and exits (Docker keeps retrying); fix the cause and rerun `docker compose up -d`.

## Moving to two containers
Versions before this change ran `auth`, `content`, `quiz`, `ai-gateway`, `notes`, `mcp`, a `migrate` job and (optionally) a bundled `postgres`. They are now `web` and `api`, and the database is your own Postgres. Image names change to `ultimyr-api` and `ultimyr-web` (the per-service images are no longer built). No data changes: the same schemas and migrations are used.

If you used the bundled Postgres, move the data first (skip this if you already pointed Ultimyr at your own server):
```sh
# 1. In the old layout, dump the database and keep the secrets
./scripts/backup.sh                       # old script version: docker compose exec postgres pg_dump ...
# 2. On your shared Postgres: create the role and database
docker exec -i postgres psql -U postgres -v pw="$(cat secrets/pg_password)" < deploy/postgres/setup.sql
# 3. Load the dump into it (--no-owner makes the ultimyr role the owner)
docker exec -i -e PGPASSWORD="$(cat secrets/pg_password)" postgres pg_restore -U ultimyr -d ultimyr --no-owner < backups/<timestamp>/ultimyr.dump
# 4. Point .env at it: PG_HOST=postgres, DB_NETWORK=<its network>; keep secrets/pg_password as the ultimyr role's password
git pull && ./scripts/update.sh
```
`update.sh` stops with a message if an old bundled Postgres container is still there, so it can never be removed before its data is moved. Once Ultimyr works against the new database you can delete the old container and its `ultimyr_pgdata` volume. Keep every other secret as it is: the same `auth_enc_key`, `vault_kek` and `jwt_private_key.pem` keep existing sessions, TOTP seeds and AI keys working. To go back, `ULTIMYR_TAG` cannot help across this change, so restore from the backup you took in step 1 on the old checkout.

## Rotating secrets
| Secret | Effect and procedure |
|---|---|
| `jwt_private_key.pem` | Replace the file, restart auth. Everyone signs in again. |
| `auth_enc_key` | Not rotatable in place yet. Changing it breaks TOTP and IdP secrets (see [configuration.md](configuration.md)). |
| `api_key_pepper` | Changing it revokes all API keys. |
| `vault_kek` | Rotate with a version bump and `rewrap-keys` (see [ai.md](ai.md#operating-it)). Replacing it without that makes stored AI keys unreadable. |

## Troubleshooting
| Symptom | Likely cause and fix |
|---|---|
| Auth exits at start: "ULTIMYR_AUTH_ENC_KEY ... required" | Production mode needs all three secrets. Run `scripts/init-secrets.sh` and check the compose secret mounts. |
| Passkey registration or login fails | `ULTIMYR_PUBLIC_URL` does not match the address in the browser, or the site is not HTTPS (localhost is the only http exception). |
| SSO returns to login with `sso_failed` or `invalid_saml_response` | Check the provider's redirect or ACS URL, certificate, and (SAML) issuer. Auth logs the real reason at warn level. |
| `account_exists` after SSO | A local account has that email. Sign in with the password, or enable `trustEmail` on the provider if you trust it to verify emails. |
| SSO provider rejected with `insecure_idp_url` | Provider URL is `http://`. Use https (dev only: `ULTIMYR_ALLOW_INSECURE_IDP=true`). |
| Login loops back to the sign-in page behind HTTPS | `COOKIE_SECURE=true` but the proxy is serving http, or the reverse is true. Match them. |
| `/api/v1/...` returns 404 or 502 from web | The web image was built with the wrong `AUTH_URL`, `CONTENT_URL` or `QUIZ_URL`. Rebuild: `docker compose build web`. |
| Claude cannot connect to MCP | See [mcp.md](mcp.md#troubleshooting). The proxy must forward `/mcp`, `/oauth/*` and `/.well-known/*` and the site must be https. |
| AI features say "not set up" | `vault_kek` is missing. Run `scripts/init-secrets.sh` and restart `ai-gateway`. |
| 429 on login or MFA | Rate limit (10 per minute per client, session refresh has its own 300 per minute limit) or TOTP lockout after repeated bad codes. Wait and retry. |
| Locked out of TOTP with no recovery codes | An admin cannot reset it through the API yet. As a last resort delete the row from `auth.totp_factors` for that user in SQL. |

## Error page
A page that throws while rendering shows a short error screen with Try again, a link home and the Next.js error digest, which also appears in the web container log.
