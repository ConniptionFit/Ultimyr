# ADR 0010: Display preferences, extra time and a minimal PWA

**Status:** Accepted (Phase 8)

## Decisions
- **Display preferences live in a cookie, rendered on the server.** Theme, size, font, calm mode and width become data attributes on `<html>`, so there is no flash and no per-user database row. They do not follow a person across devices; that is acceptable for comfort settings.
- **Extra time is self-declared** (0, 25, 50, 100 percent) and stored on the attempt. Ultimyr is a practice tool, so asking for proof would add friction and privacy cost with no benefit. The deadline is fixed once at the start, and results say extra time was used.
- **The service worker caches nothing but its offline page and icons.** Pages, API, OAuth and MCP are never cached, so there is no stale data and no private data at rest. This gives installability without the risk of an offline layer. Real offline study would need sync and conflict rules and is deferred.
- **Session refresh has its own looser rate limit** (300 per minute per IP). Every page load refreshes, and shared school or office addresses would otherwise be logged out by the 10 per minute credential limit.
- **A CI performance budget** (gzip JS 500 KB (raised from 450 KB for the prep tools), biggest chunk 90 KB, CSS 15 KB) keeps the app usable on slow connections.

## Consequences
Cookie preferences reset on a new device. The offline page is the only offline feature. Budgets may need raising deliberately as features land.
