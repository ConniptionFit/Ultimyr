# ADR 0012: Roadmaps and external resources

**Status:** Accepted

## Context
Learners need more than the material authored inside Ultimyr. Vendors publish their own training (for example Anthropic's training pages and YouTube videos), and people want one ordered plan that mixes both.

## Decisions
- **Two small additions to the content service, not a new service.** Resources and roadmaps share the archive's sharing, drafts and trash rules, so they live beside it. Roadmap progress is per person, like the daily review.
- **One roadmap per archive, saved as a whole document.** `PUT` replaces it; kept step ids keep progress. This is what makes `set_roadmap` over MCP a single, reviewable call, and it avoids a fragile set of fine grained reorder endpoints.
- **Links are stored, never fetched.** No title scraping, thumbnails or oEmbed. This removes server side request forgery from the design, keeps the page free of third party embeds (no tracking, no CSP exceptions) and works offline from the vendor. Titles and minutes come from the person or the MCP client. Only `https` links without credentials are accepted, and they open with `noopener noreferrer`.
- **De-duplicate by link per archive.** Tracking parameters are dropped, so repeating an import or an MCP call updates rather than duplicates.
- **Same draft rule as guides.** MCP and AI writes are drafts until a person publishes. The MCP instructions say never to invent a URL; since links cannot be verified, review is the control.
- **Export and import use positions and links, not ids**, so the archive file stays portable. Steps on quizzes are omitted because quizzes are not in the file.

## Consequences
Dead links are only found by the learner. A later phase could add an optional, admin-enabled link checker that is explicit about what it fetches. Per-person progress is not exported.
