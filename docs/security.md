# Security review and checklist

This is the project's own review of what Ultimyr protects, how, and what is left. It is not an independent audit.

## What is protected, and how
| Asset | Protection |
|---|---|
| Passwords | Argon2id, per-IP rate limit (10 per minute), TOTP lockout after repeated bad codes |
| Sessions | Short EdDSA access tokens (10 min), rotating 30 day refresh cookie (HttpOnly, SameSite=Lax, Secure in production) with reuse detection |
| TOTP seeds, IdP secrets | AES-256-GCM with `auth_enc_key` |
| API keys | Shown once, stored as HMAC with `api_key_pepper`, scoped, revocable |
| AI provider keys | Envelope encryption: a per-person key wrapped by `vault_kek`. Never returned by any API. Deleting your AI data destroys the key (crypto-shred) |
| Quiz answer keys | Never sent to learners until a question is checked or the attempt closes. Snapshotted per attempt |
| MCP and OAuth | OAuth 2.1 with PKCE S256, public clients only, single-use 5 minute codes, 30 minute access tokens, rotating refresh tokens with reuse detection, per-scope tool listing, writes land as drafts |
| Browser | `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN` and a restrictive `Permissions-Policy` on every page, `frame-ancestors 'none'` on the consent page. APIs answer `no-store` |
| Service worker | Caches only the offline page and icons, never pages, API, OAuth or MCP |

Credential records (including voucher codes, stored as plain text so you can copy them back) are private to their owner: no sharing, and the MCP `get_credentials` tool returns only whether a voucher exists. Keep voucher codes out of notes you share.

## Trust boundaries
- Only the **web** container needs to be public. It forwards `/api`, `/oauth`, `/mcp` and `/.well-known` to the internal services. The other ports bind to `127.0.0.1` by default.
- Services verify tokens with the auth service's public key. They never see passwords.
- Each service has its own Postgres schema. A bug in one service's queries cannot read another's tables through the ORM.
- All tool and AI output is treated as untrusted: Markdown is rendered without raw HTML, AI and MCP content is saved as a draft, and prompts keep user material in delimited blocks.

## Deployment checklist
- [ ] HTTPS in front of the web container, `COOKIE_SECURE=true`, `ULTIMYR_PUBLIC_URL` exact
- [ ] Ask the proxy to add HSTS (`Strict-Transport-Security: max-age=31536000`) once HTTPS works
- [ ] `scripts/init-secrets.sh` run, `./secrets` backed up separately from the database
- [ ] `AUTH_REGISTRATION=closed` after the admin exists (unless you want open sign up)
- [ ] Auth, content, quiz, AI and MCP ports not exposed beyond localhost
- [ ] `ULTIMYR_ALLOW_INSECURE_IDP` and `AI_ALLOW_INSECURE_PROVIDER` unset
- [ ] Admin has TOTP or a passkey
- [ ] Proxy forwards the real client address (rate limits are per IP) and limits request size
- [ ] Backups tested with `scripts/restore.sh` on a copy
- [ ] GitHub private vulnerability reporting enabled on the repository

## Known limits (candidates for later)
- Access tokens are not bound to one service. Short lifetimes and refresh revocation limit exposure. A revoked MCP connection works until its token expires (up to 30 minutes).
- `auth_enc_key` cannot be rotated in place.
- No Content-Security-Policy for scripts yet. Next.js inline scripts need nonces, which would make every page dynamic. Markdown has no raw HTML, which is the main XSS path.
- Removing a person through SCIM deactivates them but does not yet purge their AI vault automatically. An admin can call the delete endpoint.
- Registration is open to anyone who can reach the server unless closed. Dynamic client registration for MCP is rate limited and capped.
- Self-declared extra time cannot be verified.
- An anonymous visit shows one 401 from `/auth/refresh` in the browser console. That is the session check, not an error.

## Testing performed
Unit and integration tests in every service (auth 95, quiz 25, content 26, AI gateway 45, MCP 11, plus scoring, FSRS and lore libraries), run against a real Postgres in CI. Browser checks with axe-core and Lighthouse. `scripts/loadtest.mjs` (see [operations.md](operations.md#load-check)). No third-party penetration test has been done.

## Your data download
Settings > Your data builds a zip in the browser from calls the app already makes as you (profile, `archives/:id/export`, `notes/archives/:id/text`, `credentials`, `attempts`, `analytics?days=365`). Nothing new is exposed on the server, and passwords, API keys and AI keys are not part of any of those responses.
