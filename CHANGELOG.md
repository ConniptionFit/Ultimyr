# Changelog

## Unreleased
- **New:** guided SCIM setup in Admin panel > Provisioning. Choose authentik (default), Okta, Microsoft Entra ID, Keycloak or any other provider, then follow numbered steps with copy buttons for the address and token, inline token generation, a progress checklist and links straight to the matching page in your provider. Includes a terminal connection check.
- **Settings rework:** your own settings now live behind the account icon in the menu bar (Your settings: display, security, AI keys, connected apps, themed names, which stays at the bottom and is off by default). Administrators also get an **Admin panel** there, with a category list on the left that opens on General, then Users, Groups, Sign-in methods, Provisioning and the Audit log. Non-admins never see it, and the server rejects admin calls from anyone without the administrator role.
- **New:** admins can open or close registration from General (`GET/PATCH /api/v1/admin/settings`, `GET /api/v1/admin/overview`). It overrides `AUTH_REGISTRATION` until reset. Adds migration `0004_instance_settings`.
- **Fix:** clicking the Ultimyr logo no longer looks like a sign out. The splash page ignored your session and its button led to the sign in form. Signed in people now go straight to the reading room from the logo and the splash, and the sign in and register pages send them on instead of showing the form.

## 1.0.0 (2026-10-04)
First complete release. All nine roadmap phases are in.

- **Platform:** pnpm TypeScript monorepo, Fastify services (auth, content, quiz, AI gateway, MCP), Next.js web app, Postgres with one schema per service, Docker Compose with Nginx Proxy Manager (default) or Traefik.
- **Identity:** passwords, TOTP, passkeys, API keys, OIDC, OAuth2, SAML, SCIM 2.0, groups, admin API.
- **Content:** archives, guides, decks, versions, sharing, search, import and export, trash.
- **Quizzes:** five question types, practice, timed and exam modes with a server clock, exact versioned scoring.
- **Study:** FSRS-5 daily review, progress, goals, readiness estimate.
- **AI:** bring your own Gemini, OpenAI or Anthropic key, encrypted per person, draft generation, study assistant.
- **MCP:** OAuth 2.1 connected apps, scoped tools, drafts for writes.
- **Polish:** themes, text size, easy-read font, calm and focus modes, declared extra time, installable app with offline page, example archive, performance budget.
- **Hardening:** baseline security headers, `no-store` API responses, backup and restore scripts, load check script, security review and runbooks.

Not included: Gemini sign in with Google OAuth (paste a key instead), offline study, third-party audit.

Upgrading from an earlier phase build: back up first (`scripts/backup.sh`), then `git pull`, `./scripts/init-secrets.sh`, `docker compose up -d --build`. Migrations run automatically and are forward only.
