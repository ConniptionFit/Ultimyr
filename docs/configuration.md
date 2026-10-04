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
| `ULTIMYR_AI_PORT` | `4004` | Published AI gateway port. |
| `ULTIMYR_MCP_PORT` | `4005` | Published MCP server port. |

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
| `ULTIMYR_PUBLIC_URL` | `http://localhost:3000` | Exact origin users browse to. Sets the passkey relying party, SSO callback URLs and the OAuth issuer for MCP apps. Changing it later orphans passkeys. |
| `ULTIMYR_ALLOW_INSECURE_IDP` | false in production | Allow `http://` identity providers (otherwise only `https://` is accepted). Local testing only. |

Rate limits are fixed per IP address: 10 per minute on credential endpoints (sign in, MFA, register) and 300 per minute on session refresh, which every page load calls (looser so a classroom behind one address is not locked out). Behind a proxy, make sure it forwards the client address.

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
| `QUIZ_SSE_INTERVAL_MS` | `10000` | How often the live exam clock (`/attempts/:id/events`) sends the time. Lower it only for testing. |
| `QUIZ_AUTO_MIGRATE` | false | Run migrations at start. Compose uses the one-shot `migrate` job. |

## AI gateway
| Variable | Default | Purpose |
|---|---|---|
| `PORT`, `HOST` | `4004`, `0.0.0.0` | Listen address. |
| `AUTH_URL`, `CONTENT_URL`, `QUIZ_URL` | localhost ports | Compose sets `http://auth:4001`, `http://content:4002`, `http://quiz:4003`. |
| `ULTIMYR_VAULT_KEK` | none | **Secret.** Master key (`openssl rand -base64 32`). Without it every AI route answers 503. |
| `ULTIMYR_VAULT_KEK_VERSION` | `1` | Version number of the current master key. |
| `ULTIMYR_VAULT_KEK_PREVIOUS` | none | Older keys still needed to read data, as `1:<base64>,2:<base64>`. See [ai.md](ai.md). |
| `AI_DAILY_REQUESTS` | `200` | Per person per day. |
| `AI_MAX_OUTPUT_TOKENS` | `8192` | Cap per request. |
| `AI_DEFAULT_MODEL_GEMINI`, `_OPENAI`, `_ANTHROPIC` | `gemini-2.5-flash`, `gpt-4.1-mini`, `claude-haiku-4-5-20251001` | Used when a person has not chosen a model. |
| `AI_BASE_URL_GEMINI`, `_OPENAI`, `_ANTHROPIC` | provider defaults | Override the provider address (must be https). |
| `AI_ALLOW_INSECURE_PROVIDER` | false | Allow http provider URLs. Local testing only. |

## Notes service
| Variable | Default | Purpose |
|---|---|---|
| `PORT`, `HOST` | `4006`, `0.0.0.0` | Listen address. |
| `AUTH_URL`, `CONTENT_URL` | localhost ports | Compose sets `http://auth:4001`, `http://content:4002`. |
| `FNS_URL` | none | Address of your Fast Note Sync server (for example `http://fns:9000`). Operator only: people cannot change it. Empty means notes are off. See [notes.md](notes.md#sync-with-obsidian). |
| `ULTIMYR_VAULT_KEK`, `_VERSION`, `_PREVIOUS` | as the AI gateway | The same master key. It seals each person's sync token. Without it notes are off. |
| `NOTES_AUTO_MIGRATE` | false | Run migrations at start. Compose uses the one-shot `migrate` job. |

## MCP server
| Variable | Default | Purpose |
|---|---|---|
| `PORT`, `HOST` | `4005`, `0.0.0.0` | Listen address. |
| `AUTH_URL`, `CONTENT_URL`, `QUIZ_URL` | localhost ports | Compose sets `http://auth:4001`, `http://content:4002`, `http://quiz:4003`. |
| `NOTES_URL` | `http://localhost:4006` | The notes service, for the step note tools. Compose sets `http://notes:4006`. |
| `ULTIMYR_PUBLIC_URL` | `http://localhost:3000` | Names this server in OAuth metadata. Must be the address clients use. Auth uses the same setting as the OAuth issuer. |
| `MCP_RATE_PER_MINUTE` | `120` | Requests per person per minute. |
| `MCP_WRITE_PER_MINUTE` | `30` | Write tool calls per person per minute. |

## Secrets (production required)
| Secret | Generate | If you lose or change it |
|---|---|---|
| `ULTIMYR_JWT_PRIVATE_KEY` | `openssl genpkey -algorithm ed25519` | New key means all sessions and tokens are invalid. Users sign in again. |
| `ULTIMYR_AUTH_ENC_KEY` | `openssl rand -base64 32` | TOTP seeds and IdP client secrets become unreadable. Users re-enrol TOTP, admins re-enter IdP secrets. |
| `ULTIMYR_API_KEY_PEPPER` | `openssl rand -base64 32` | Every API key stops working. |

The AI gateway also uses `ULTIMYR_VAULT_KEK` (`openssl rand -base64 32`). If you lose it, stored AI keys become unreadable and people add them again. It is optional: without it AI is simply off.

`scripts/init-secrets.sh` creates all of these plus the vault key and the DB password, and never overwrites existing files. In development the last two fall back to insecure built-in values, so never run `NODE_ENV=production` without real ones (the service refuses to start).

## Web app
| Variable | Where | Purpose |
|---|---|---|
| `AUTH_URL`, `CONTENT_URL`, `QUIZ_URL`, `AI_URL`, `MCP_URL` | **Build args** | Where Next.js forwards auth, content, quiz, AI and MCP paths. Rewrites are fixed at build time, so rebuild the web image to change them. Compose sets `http://auth:4001`, `http://content:4002`, `http://quiz:4003`, `http://ai-gateway:4004` and `http://mcp:4005`. |
