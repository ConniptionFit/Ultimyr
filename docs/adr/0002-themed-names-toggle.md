# ADR 0002: Themed names are presentation only

**Status:** Accepted (Phase 1)

Ultimyr's lore names (Archive, Codex, Folio, Trial, Vigil, The Archivist) are labels, never identifiers.

- Every themed name has a plain equivalent in `packages/lore` (Course, Study guide, Flashcard deck, Quiz, Daily review, AI assistant). A unit test enforces this.
- Users switch with **Settings > Themed names**. The choice is stored in the `ultimyr_naming` cookie so server rendering has no flash. Default is plain, so new users opt in to themed names. The toggle sits at the bottom of Settings and the full names list is collapsed by default.
- API routes, MCP tool names, database columns and exports use plain names only.
