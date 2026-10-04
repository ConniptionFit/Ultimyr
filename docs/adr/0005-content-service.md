# ADR 0005: Content service shape

**Status:** Accepted (Phase 3)

## Decisions
- **Plain SQL, no ORM.** The content queries (access checks, full text search, versioned snapshots) are clearer in SQL than in a query builder. Every query is parameterised.
- **One access function in SQL.** `ARCHIVE_REL` and `ITEM_GRANT` in `access.ts` compute a numeric rank (attempt 1, viewer 2, editor 3, owner 4) from ownership, visibility and grants. Lists, search and single-object checks all use it, so they cannot disagree. It can be swapped for OpenFGA later without touching routes.
- **Best grant wins, no deny.** Item grants add to archive grants and never subtract. Simpler to reason about, and revocation is deleting a grant.
- **Group membership comes from the auth API**, not a copied table. It is cached for 30 seconds, and if auth is down, group grants pause while ownership and direct grants continue.
- **Tokens are verified statelessly.** A suspended user or revoked session keeps working in content until the 10 minute token expires. That is the trade for not calling auth on every request.
- **Quiz items are shells.** The content service stores the quiz as an item (title, sharing, trash) and the quiz service owns questions and attempts.
- **Drafts for AI and MCP.** Anything not written by a person directly starts unpublished.
- **Icons in Postgres.** Small, validated, re-encoded PNGs live in a table, so backups are one `pg_dump` and there is no object store to run.

## Consequences
Search quality is English-only stemming for now. Large decks and guides are bounded by hard limits (see content.md). Direct SQL means schema changes need careful migrations.
