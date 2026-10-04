# Security policy

## Reporting a vulnerability
Please report privately through GitHub: **Security tab > Report a vulnerability** on this repository. Do not open a public issue. Include steps to reproduce and the version or commit. You can expect an acknowledgement, then a fix or a clear explanation.

## Scope
The auth service (sessions, MFA, passkeys, API keys, SSO, SCIM), the web app, and the Docker and Compose setup.

## What the project does today
Argon2id passwords, rotating refresh tokens with reuse detection, EdDSA JWTs, AES-256-GCM for stored secrets, HMAC-hashed API keys, rate limiting, PKCE/state/nonce for OIDC, signed-assertion checks for SAML. Details in [docs/architecture.md](docs/architecture.md) and [docs/identity.md](docs/identity.md).

## Hardening your install
- Serve only over HTTPS and set `COOKIE_SECURE=true`.
- Keep `./secrets` out of version control (it is gitignored) and back it up separately from the database.
- Consider `AUTH_REGISTRATION=closed` after creating the admin.
- Never set `ULTIMYR_ALLOW_INSECURE_IDP=true` in production.
- Do not expose the auth port publicly unless you need headless API access; the default binds to localhost.
