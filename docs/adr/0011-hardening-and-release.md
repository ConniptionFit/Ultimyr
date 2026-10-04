# ADR 0011: Hardening choices for 1.0

**Status:** Accepted (Phase 9)

## Decisions
- **Headers set where they are owned.** Next.js sets browser headers for pages; each API service sets `nosniff`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store` (unless a route sets its own) in one hook. HSTS is left to the reverse proxy, because only it knows whether HTTPS is really in place.
- **No script CSP yet.** A strict CSP needs per-request nonces for Next.js inline scripts, which would make every page dynamic and slow. Markdown rendering has no raw HTML, which closes the main injection route. Revisit when it can be done without cost.
- **Plain shell scripts for backup and restore**, wrapping `pg_dump` and `pg_restore` in the bundled Postgres. Secrets are archived separately so they are never stored next to the data they protect.
- **A dependency-free load check** that only reads public pages, so it can run against a live install.
- **Per-service token audiences, automatic SCIM data purge and in-place key rotation** are listed as known limits, not 1.0 work. Each has a manual workaround documented.

## Consequences
1.0 is a complete, documented, self-hostable release with honest limits. Independent review is still recommended before holding sensitive data.
