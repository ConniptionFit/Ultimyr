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

Restore: start Postgres, load the dump, put the same secrets back, start the stack.

## Upgrading
```sh
git pull
./scripts/init-secrets.sh        # adds any new secret files, keeps existing ones
docker compose up -d --build
```
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
