# Identity and access (Phase 2)

All of this lives in the `auth` service. Set `ULTIMYR_PUBLIC_URL` to the exact origin users browse to (for example `https://ultimyr.example.com`). Passkeys are bound to its hostname and SSO callbacks are built from it.

## Secrets
`scripts/init-secrets.sh` creates two new files next to the DB password and JWT key:
- `secrets/auth_enc_key`: AES-256-GCM key for TOTP seeds and IdP client secrets. **Back it up.** Losing it locks every user out of TOTP and breaks every OIDC/OAuth2 provider.
- `secrets/api_key_pepper`: HMAC key for API key hashes. Changing it revokes every API key.

In production the service refuses to start without both.

## Sign-in methods
| Method | Notes |
|---|---|
| Password | argon2id. If TOTP is on, login returns `mfaRequired` plus a short MFA token. |
| TOTP + recovery codes | 6 digit codes, replay protected, lockout after repeated failures. 10 single use recovery codes. |
| Passkeys | WebAuthn, user verification required. Add and remove under Settings > Security. |
| OIDC / OAuth2 | PKCE, state, nonce, discovery. Subjects are matched by provider plus subject, never by email alone. |
| SAML 2.0 | SP-initiated only. Signed assertions required, audience, expiry, issuer and InResponseTo are enforced. |

Existing local accounts are never auto-linked by email unless the provider has `trustEmail` enabled.

## Adding an identity provider
Admin only. `POST /api/v1/admin/idp-providers` with a bearer token.

```jsonc
// OIDC (Entra, Okta, Keycloak, Google, Authentik...)
{ "kind": "oidc", "slug": "acme", "name": "Acme SSO", "clientSecret": "...",
  "config": { "issuer": "https://login.example.com", "clientId": "..." } }
```
- Redirect URI to register at the IdP: `{PUBLIC_URL}/api/v1/auth/sso/{slug}/callback`
- `kind: "oauth2"` is for providers without OIDC (needs `authorizeUrl`, `tokenUrl`, `userinfoUrl`).
- `kind: "saml"`: give `entryPoint`, `idpCert` (PEM) and ideally `idpIssuer`. SP metadata: `{PUBLIC_URL}/api/v1/auth/saml/{slug}/metadata`. ACS URL: `{PUBLIC_URL}/api/v1/auth/saml/{slug}/acs`.
- `groupClaim` (OIDC) or `groupsAttr` (SAML) maps IdP groups to Ultimyr groups, prefixed with the provider name.
- IdP URLs must be https. For local testing only, set `ULTIMYR_ALLOW_INSECURE_IDP=true`.

## SCIM 2.0 provisioning
1. Create a token: `POST /api/v1/admin/scim-tokens` (shown once).
2. Point your IdP at `{PUBLIC_URL}/scim/v2` with that bearer token.
3. Users and Groups are supported, including the Okta and Entra PATCH styles. SCIM-managed users are flagged `scim_managed`.

## API keys
Created under Settings > Security. A key (`ulk_...`) is exchanged at `POST /api/v1/auth/token` for a short lived access token limited to the key's scopes. Key tokens can never change account security settings.

## Security notes
- Refresh tokens rotate and reuse revokes the whole session family.
- Admin actions, sign-ins, MFA changes and key use are written to the audit log (`GET /api/v1/admin/audit`).
- If the first admin loses their authenticator and recovery codes, reset by deleting their row in `auth.totp_factors` with SQL.
