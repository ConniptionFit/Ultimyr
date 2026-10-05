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
Administrators (role `platform_admin`) see **Admin panel** in the account menu (the person icon in the menu bar). Everyone else does not, and `/admin` shows a plain "not available" screen. The one exception is the **Curriculum admin** role (see below), which opens only the Group access page. The screen is only a convenience: every admin API call is checked on the server, so a non-admin token gets 403 whatever the page shows. Categories are listed on the left and open on **General**:

| Category | What it does |
| --- | --- |
| General | Counts, the registration switch, deployment details. |
| Users | Add a person, search, suspend or reinstate, edit roles, issue a new sign-in link. The last active administrator is protected. |
| Groups | Create local groups and manage members. SSO and SCIM groups are read only. |
| Group access (Keys of Passage) | Choose which groups (including SCIM groups) can view or manage which courses. See below. |
| Sign-in methods | A step by step setup guide for OpenID Connect and SAML (authentik by default, plus Okta, Microsoft Entra ID, Keycloak and any other provider), and add, enable and remove OIDC, OAuth 2 and SAML providers, and the switch that disables local accounts. |
| Provisioning | A step by step SCIM setup guide (authentik by default, plus Okta, Microsoft Entra ID, Keycloak and any other provider), and SCIM token management. |
| Audit log | Latest sign-ins and admin actions, with a filter. |
| About this app (Colophon) | Name, repository, license, running version and commit, whether an update is available, the latest changelog, and links to docs and issue or security reporting. Needs outbound HTTPS to GitHub for the update check, which you can turn off with `ULTIMYR_UPDATE_CHECK=false`. |

**Group access.** Admin panel > Group access (themed: Keys of Passage) answers "which groups can use which courses?" in one place. Pick a group and set each course to **No access**, **Can view** (study the published material) or **Can manage** (also edit it). Each course also shows whether it is **Open to everyone** or **Restricted**. A course open to everyone stays visible to everyone, including after an upgrade, until an administrator clicks **Restrict**; restricted courses are visible only to their owner, direct grants and the groups you choose. Groups arrive from SCIM or SSO as usual and appear in the list as they sync, and membership changes apply within 30 seconds.

**Curriculum admin role** (themed: Keeper of the Archives). Give someone the **Curriculum admin** role under Users and they get full access to every course and its settings: create, edit, share, change who can see it, remove and restore, plus the Group access page. They can also work on every course's guides, decks and quizzes, as if they owned them. They are not platform administrators: no Users, Sign-in, Provisioning, Audit log or other installation settings, and the server rejects those calls. People who held the earlier **Access delegate** role are moved to Curriculum admin by the upgrade (it is a wider role than before), so review who has it under Users.

Everything that only affects your own session (display, security, AI keys, connected apps, themed names) is under **Your settings** in the same menu.

**Registration switch.** General has "Allow new sign-ups". It overrides `AUTH_REGISTRATION` until you choose "Use the default". The first account on a fresh install is always allowed.

## SCIM 2.0 provisioning
**Guided setup.** Admin panel > Provisioning opens a setup guide. Pick a provider (authentik is the default), optionally type your provider's address so each step gets a direct link to the right page in that provider, generate a token inline, and copy the address and token with one click. Tick steps off as you go (progress is remembered in your browser). Menu names come from each vendor's current docs, so a provider that renames menus may differ slightly. Keycloak has no outbound SCIM of its own, and the guide says so.

Things every provider needs: the provider must be able to reach `{PUBLIC_URL}/scim/v2` from its own servers, and `userName` must be an email address.

**By hand.**
1. Create a token: `POST /api/v1/admin/scim-tokens` (shown once).
2. Point your IdP at `{PUBLIC_URL}/scim/v2` with that bearer token.
3. Users and Groups are supported, including the Okta and Entra PATCH styles. SCIM-managed users are flagged `scim_managed`.

## Adding people by hand
Admin panel > Users > **Add a person** creates a local account without SCIM or SSO. Enter a name, email and roles (default Author and Learner), then pick how they get in:

- **Invite link** (default): you get a one-time link, valid 7 days. They open it and choose their own password. Send it yourself; Ultimyr does not send email.
- **Temporary password**: generated, or typed by you (12 characters or more). Their first password sign-in stops at a "Choose a new password" step and no session exists until they complete it.

The link or password is shown once and stored only as a hash. **New sign-in link** on a local user's row issues a fresh link (for a lapsed invite or a forgotten password) and cancels older ones.

## Disabling local accounts
Sign-in methods > **Disable local accounts** (off by default) is for installs that want everyone to come through the identity provider. When on, the server refuses password, passkey and sign-up access, existing sessions and refresh, and manual creation for any account that was not created by SSO or SCIM and is not linked to a provider. Accounts that signed in through a provider keep working.

Two safeguards against lockout:

- It cannot be switched on unless at least one provider is enabled (409 `no_identity_provider`).
- **Local administrators are exempt** and can still sign in with a password, as a break-glass way back in if the provider is down or misconfigured. Remove the administrator role from local accounts you do not want to keep that power.

## API keys
Created under account menu > Your settings > Security. A key (`ulk_...`) is exchanged at `POST /api/v1/auth/token` for a short lived access token limited to the key's scopes. Key tokens can never change account security settings.

## Security notes
- Temporary passwords and invite links are shown once, stored hashed (links) or as an argon2 hash (passwords), and invite links are single use. Redeeming one revokes the account's existing sessions.
- Refresh tokens rotate and reuse revokes the whole session family.
- Admin actions, sign-ins, MFA changes and key use are written to the audit log (`GET /api/v1/admin/audit`).
- If the first admin loses their authenticator and recovery codes, reset by deleting their row in `auth.totp_factors` with SQL.
