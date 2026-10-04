# Changelog

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
