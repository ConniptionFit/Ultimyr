# ADR 0006: Quiz service and scoring engine

**Status:** Accepted (Phase 4)

## Decisions
- **Scoring is a separate pure package** (`@ultimyr/scoring`). It has no I/O, clock or randomness, uses integer milli-points and basis points, and takes its rules from a declarative profile. It runs in the service today and can run in the browser later.
- **Profiles are immutable and snapshotted.** Each attempt stores its own copy of the profile and of every question (with its key). Later edits cannot change a past result. Replacing a profile means a new version.
- **Fidelity is a required, honest label** (published formula, community estimate, custom). We never present an estimate as an official exam score.
- **The server owns the clock.** `deadline_at` is set at start; late saves beyond a grace window are refused and the attempt is graded as of the deadline. The browser timer is only decoration.
- **No answer keys before their time.** The learner's copy of a question carries no key or explanation. They arrive per question after "Check answer" (practice only) or for everything once the attempt closes.
- **Access is decided by content.** The quiz service asks content `GET /v1/access/item/:id` with the caller's own token. It does not copy grants, so sharing has one source of truth. Tests inject a stub for this lookup.
- **Quiz routes have their own prefixes** (`/quizzes/:id/...`, `/questions`, `/attempts`, `/scoring-profiles`) so a path-routing proxy can send them to the quiz service without clashing with content's `/items`. This replaces the plan's `/banks` and `/me/analytics` paths, since `/me` belongs to auth.
- **A bank is the quiz item.** Questions belong directly to a quiz item, rather than to a separate bank object. Domains are a free-text field on a question, not a table. This keeps authoring simple and can grow later.
- **Trial questions** (`isPretest`) are delivered but never scored, and the learner is not told which they are.

## Consequences
A quiz item must exist in content before it can hold questions. The number of attempts kept is unbounded for now (analytics in the next phase will summarise them). Free-text domains can drift in spelling, so the editor reuses what was typed before in a later polish pass.
