# Operations

## First run
1. `cp .env.example .env`, set `ULTIMYR_PUBLIC_URL`, pick a proxy overlay.
2. `./scripts/init-secrets.sh`
3. `docker compose --profile bundled-db up -d --build` (drop the profile for your own Postgres).
4. Open the site and register. The first account is the platform admin. Then consider `AUTH_REGISTRATION=closed`.
5. Set `COOKIE_SECURE=true` once HTTPS works.

## Health
- `GET /healthz` (process) and `GET /readyz` (database) on the auth service, port 4001. The auth container has a Docker healthcheck on `/healthz`.
- `docker compose ps` and `docker compose logs -f auth`.
- Failed sign-ins, MFA events, key use and admin changes are in the audit log (`GET /api/v1/admin/audit`).

## Services
`auth`, `content`, `quiz`, `ai-gateway` and `mcp` each have `/healthz` and `/readyz`. Quiz needs content to authorise requests: while content is unreachable, quiz answers 503 (attempts already in progress are not lost, and their clocks keep running). Content starts without auth, but until auth is reachable it cannot verify new tokens. The AI gateway needs auth, content and quiz to be reachable to verify tokens and save drafts. It starts without a vault key, with AI features answering 503. Deleted archives and items are purged after 30 days by a job inside the content service (every 6 hours).

## Backups
Back up two things:
- **Postgres**: `docker compose exec postgres pg_dump -U ultimyr ultimyr > ultimyr.sql` (bundled DB), or your own server's usual method.
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
CI builds every service on each merge to `main` and on each release tag (`v*`) and publishes the images to the Forgejo container registry at `git.pwrs.dev/powers/ultimyr-<service>` (the default) and to GitHub's (`ghcr.io/conniptionfit/ultimyr-<service>`, amd64 and arm64). The Forgejo images are built by `.forgejo/workflows/image.yml` for the Docker host's own architecture. Nothing compiles on your server. One step: `./scripts/update.sh` (saves local edits to a git stash so `git pull` is never blocked, pulls the repo files, adds new secrets, pulls the images, restarts what changed, waits for health and prints the version). Or by hand:
```sh
git pull                          # only needed when docker-compose.yml, .env.example or scripts changed
./scripts/init-secrets.sh        # adds any new secret files, keeps existing ones
docker compose pull && docker compose up -d
```
If you only want the newest app and never touch the compose files, `docker compose pull && docker compose up -d` is enough. Add `--profile bundled-db` when you use the bundled database.

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

The `migrate` container runs first and applies new migrations once. Migrations are forward only. Take a backup before upgrading across phases. If a migration fails, auth does not start; fix the cause and rerun `docker compose up -d`.

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
