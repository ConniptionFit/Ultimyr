# ADR 0007: Spaced repetition, analytics and goals

**Status:** Accepted (Phase 5)

## Decisions
- **FSRS-5, implemented in a small pure package** (`@ultimyr/fsrs`). It is an open, well studied algorithm with documented default weights and needs no per-user training to start. No fuzz is applied, so schedules are reproducible and testable. Personalised weights can be added later by passing different parameters.
- **Schedules live in the content service**, not the quiz service as the plan first said. Cards and the rules that decide who may read them are in content, so the review queue can use the same access check as reading a deck. A card the person can no longer read stops appearing, and deleting a card cascades to its schedules.
- **Analytics are computed on demand from attempts**, not stored in a daily rollup maintained by a worker. Volumes per person are small, the queries use existing indexes, and nothing can drift out of date. This removes the planned `worker` service and `analytics_daily` table. If a deployment grows beyond what this handles, a materialised rollup can be added without changing the API.
- **Readiness is a transparent formula** (recency weighted mean of the last 10 attempts, minimum 3) and is labelled as an estimate. We do not claim to predict the real exam.
- **The server clock is streamed with SSE** as a convenience for display and instant close. The authority is still the deadline stored on the attempt, enforced on every request.
- **Quiz-service routes** for analytics and goals are `/analytics` and `/goals`, not `/me/...`, because `/me` belongs to the auth service for path routing.

## Consequences
Study data is per user and never shared. A long retention history costs one row per review in `srs_reviews`; pruning is not needed yet. The SSE stream holds a connection per open timed attempt, which is fine for a single-tenant install and is capped at 5 minutes per connection (the page reconnects).
