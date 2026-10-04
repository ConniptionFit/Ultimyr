# ADR 0004: Identity hardening choices

**Status:** Accepted (Phase 2)

## Decisions
- **No heavy auth framework.** OIDC and OAuth2 are implemented with `jose` and `fetch` (PKCE, state, nonce, discovery). SAML uses `@node-saml/node-saml` because hand-rolling XML signature checks is unsafe.
- **Identity key is (provider, subject).** Email is only a hint. Linking to an existing local account needs the provider's `trustEmail` flag, which prevents account takeover through a lax IdP.
- **SAML is SP-initiated only.** Requests are tracked in Postgres, so replayed or unsolicited responses fail. node-saml does not check the issuer on login responses, so the service enforces `idpIssuer` itself.
- **At-rest secrets** (TOTP seeds, IdP client secrets) use AES-256-GCM with AAD binding the value to its row. API keys are stored as HMAC hashes.
- **API keys are exchanged for scoped JWTs**, and key tokens are refused by account management routes (`authenticateInteractive`).
- **SCIM tokens** are separate from user tokens and hashed at rest.

## Consequences
Two new required production secrets (`auth_enc_key`, `api_key_pepper`). Changing `ULTIMYR_PUBLIC_URL` breaks existing passkeys.
