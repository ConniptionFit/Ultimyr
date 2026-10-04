# Configuration reference

Set values in `.env` (Compose reads it) or the container environment. Any variable marked **secret** also accepts a `_FILE` form (for example `PG_PASSWORD_FILE=/run/secrets/pg_password`), which is how Docker secrets are wired. If both are set, the `_FILE` value is used. Compose creates the secret files from `./secrets` (run `scripts/init-secrets.sh`).

## Compose and proxy
| Variable | Default | Purpose |
|---|---|---|
| `COMPOSE_FILE` | `docker-compose.yml:docker-compose.npm.yml` | Which proxy overlay to use. See the README. |
| `PROXY_NETWORK` | `proxy` | Docker network Nginx Proxy Manager is on (NPM overlay). |
| `ULTIMYR_HTTP_PORT` | `8080` | Port the bundled Traefik listens on (Traefik overlay). |
| `ULTIMYR_BIND` | `127.0.0.1` | Interface for published web and auth ports. |
| `ULTIMYR_WEB_PORT` | `3000` | Published web port. |
| `ULTIMYR_AUTH_PORT` | `4001` | Published auth port. |
| `ULTIMYR_CONTENT_PORT` | `4002` | Published content port. |
| `ULTIMYR_QUIZ_PORT` | `4003` | Published quiz port. |

## Database
Use either `DATABASE_URL` **or** the `PG_*` parts.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | none | Full connection URL (**secret**). Wins over the parts below. |
| `PG_HOST`, `PG_USER`, `PG_DATABASE` | `postgres`, `ultimyr`, `ultimyr` in `.env.example` | Required when no URL is given. |
| `PG_PORT` | `5432` | |
| `PG_PASSWORD` | empty | **Secret**. Compose supplies it from `secrets/pg_password`. |
| `PG_SSLMODE` | `disable` | `disable`, `require` or `verify-full`. |
| `TEST_DATABASE_URL` | none | Enables the auth integration tests. Use a throwaway database. |

## Auth service
| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `production` makes the three secrets below mandatory and secure cookies the default. |
| `PORT`, `HOST` | `4001`, `0.0.0.0` | Listen address. |
| `AUTH_REGISTRATION` | `open` | `closed` allows only the very first account (the admin). Later users come from SSO, SCIM or an admin. |
| `COOKIE_SECURE` | true in production | Set `true` once you serve over HTTPS. |
| `ULTIMYR_PUBLIC_URL` | `http://localhost:3000` | Exact origin users browse to. Sets the passkey relying party and SSO callback URLs. Changing it later orphans passkeys. |
| `ULTIMYR_ALLOW_INSECURE_IDP` | false in production | Allow `http://` identity providers (otherwise only `https://` is accepted). Local testing only. |

## Content service
| Variable | Default | Purpose |
|---|---|---|
| `PORT`, `HOST` | `4002`, `0.0.0.0` | Listen address. |
| `AUTH_URL` | `http://localhost:4001` | Where to fetch the signing keys (`/.well-known/jwks.json`) and group memberships. Compose sets `http://auth:4001`. |
| `CONTENT_AUTO_MIGRATE` | false | Run migrations at start. Compose uses the one-shot `migrate` job instead. |

## Quiz service
| Variable | Default | Purpose |
|---|---|---|
| `PORT`, `HOST` | `4003`, `0.0.0.0` | Listen address. |
| `AUTH_URL` | `http://localhost:4001` | Where to fetch the signing keys. Compose sets `http://auth:4001`. |
| `CONTENT_URL` | `http://localhost:4002` | Asked, per request, whether the caller may attempt or edit a quiz. If content is down, quiz requests answer 503. Compose sets `http://content:4002`. |
| `QUIZ_AUTO_MIGRATE` | false | Run migrations at start. Compose uses the one-shot `migrate` job. |

## Secrets (production required)
| Secret | Generate | If you lose or change it |
|---|---|---|
| `ULTIMYR_JWT_PRIVATE_KEY` | `openssl genpkey -algorithm ed25519` | New key means all sessions and tokens are invalid. Users sign in again. |
| `ULTIMYR_AUTH_ENC_KEY` | `openssl rand -base64 32` | TOTP seeds and IdP client secrets become unreadable. Users re-enrol TOTP, admins re-enter IdP secrets. |
| `ULTIMYR_API_KEY_PEPPER` | `openssl rand -base64 32` | Every API key stops working. |

`scripts/init-secrets.sh` creates all of these plus the DB password, and never overwrites existing files. In development the last two fall back to insecure built-in values, so never run `NODE_ENV=production` without real ones (the service refuses to start).

## Web app
| Variable | Where | Purpose |
|---|---|---|
| `AUTH_URL`, `CONTENT_URL`, `QUIZ_URL` | **Build args** | Where Next.js forwards auth, content and quiz API paths. Rewrites are fixed at build time, so rebuild the web image to change them. Compose sets `http://auth:4001`, `http://content:4002` and `http://quiz:4003`. |
