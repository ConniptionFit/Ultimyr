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
| Passkeys | WebAuthn, user verification required. Add and remove under account menu > Your settings > Security. |
| OIDC / OAuth2 | PKCE, state, nonce, discovery. Subjects are matched by provider plus subject, never by email alone. |
| SAML 2.0 | SP-initiated only. Signed assertions required, audience, expiry, issuer and InResponseTo are enforced. |

Existing local accounts are never auto-linked by email unless the provider has `trustEmail` enabled.

## Adding an identity provider
**Guided setup.** Admin panel > Sign-in methods opens with a setup guide. Pick a provider (authentik is the default) and OpenID Connect or SAML, choose the short name, and the guide shows the exact addresses to paste into your provider (redirect address, ACS address, entity ID) with copy buttons. Type your provider's address to get direct links to the right admin pages. The last steps open the Add a provider form with the type and short name filled in, then give you a test sign-in link once the provider exists. Notes the guide repeats where they matter: SAML assertions must be signed, an email address must be sent, SAML sign-in starts from Ultimyr only, and Keycloak needs Sign assertions on and Client signature required off.

**By hand.**
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

## Admin panel
Administrators (role `platform_admin`) see **Admin panel** in the account menu (the person icon in the menu bar). Everyone else does not, and `/admin` shows a plain "not available" screen. The screen is only a convenience: every admin API call is checked on the server, so a non-admin token gets 403 whatever the page shows. Categories are listed on the left and open on **General**:

| Category | What it does |
| --- | --- |
| General | Counts, the registration switch, deployment details. |
| Users | Search, suspend or reinstate, edit roles. The last active administrator is protected. |
| Groups | Create local groups and manage members. SSO and SCIM groups are read only. |
| Sign-in methods | A step by step setup guide for OpenID Connect and SAML (authentik by default, plus Okta, Microsoft Entra ID, Keycloak and any other provider), and add, enable and remove OIDC, OAuth 2 and SAML providers. |
| Provisioning | A step by step SCIM setup guide (authentik by default, plus Okta, Microsoft Entra ID, Keycloak and any other provider), and SCIM token management. |
| Audit log | Latest sign-ins and admin actions, with a filter. |

Everything that only affects your own session (display, security, AI keys, connected apps, themed names) is under **Your settings** in the same menu.

**Registration switch.** General has "Allow new sign-ups". It overrides `AUTH_REGISTRATION` until you choose "Use the default". The first account on a fresh install is always allowed.

## SCIM 2.0 provisioning
**Guided setup.** Admin panel > Provisioning opens a setup guide. Pick a provider (authentik is the default), optionally type your provider's address so each step gets a direct link to the right page in that provider, generate a token inline, and copy the address and token with one click. Tick steps off as you go (progress is remembered in your browser). Menu names come from each vendor's current docs, so a provider that renames menus may differ slightly. Keycloak has no outbound SCIM of its own, and the guide says so.

Things every provider needs: the provider must be able to reach `{PUBLIC_URL}/scim/v2` from its own servers, and `userName` must be an email address.

**By hand.**
1. Create a token: `POST /api/v1/admin/scim-tokens` (shown once).
2. Point your IdP at `{PUBLIC_URL}/scim/v2` with that bearer token.
3. Users and Groups are supported, including the Okta and Entra PATCH styles. SCIM-managed users are flagged `scim_managed`.

## API keys
Created under account menu > Your settings > Security. A key (`ulk_...`) is exchanged at `POST /api/v1/auth/token` for a short lived access token limited to the key's scopes. Key tokens can never change account security settings.

## Security notes
- Refresh tokens rotate and reuse revokes the whole session family.
- Admin actions, sign-ins, MFA changes and key use are written to the audit log (`GET /api/v1/admin/audit`).
- If the first admin loses their authenticator and recovery codes, reset by deleting their row in `auth.totp_factors` with SQL.
