# API reference

The auth service is documented first, then the content service, then the quiz service. The AI gateway is in [ai.md](ai.md#api), the notes service in [Notes](#notes-service) and the MCP server in [mcp.md](mcp.md). Each service also answers `/healthz` and `/readyz`.

# Auth service API

Base path: `/api/v1` (the service also answers the same routes under `/v1`). JSON in and out. Errors look like `{ "error": "code", "issues": ["..."] }`.

**Authentication:** `Authorization: Bearer <access token>`. Access tokens are EdDSA JWTs valid 10 minutes. Verify them with the public key at `/.well-known/jwks.json` (issuer `ultimyr-auth`, audience `ultimyr`). Claims: `sub`, `sid`, `roles`, `scopes`, `amr`.

Browser sessions get a rotating httpOnly refresh cookie (`ultimyr_rt`, 30 days). API keys get scoped tokens with no cookie. Routes marked **interactive** reject API key tokens. Routes marked **admin** need the `platform_admin` role. Sensitive routes are rate limited (default 10 per minute per client) and return 429.

## Sign in
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | `{ displayName, email, password }`. First account becomes admin. Honors `AUTH_REGISTRATION`. |
| POST | `/auth/login` | `{ email, password }`. Returns a session, or `{ mfaRequired, mfaToken, methods }` when TOTP is on. |
| POST | `/auth/change-password` | `{ changeToken, currentPassword, newPassword }`. Second step when login returns `{ passwordChangeRequired, changeToken }` (an admin-created account with a temporary password). Signs in on success. The token lasts 10 minutes. |
| POST | `/auth/set-password` | `{ token, password }`. Redeems a one-time invite or reset link from an admin and signs in. Used, expired and replaced links return 400 `invalid_token`. |
| POST | `/auth/mfa/verify` | `{ mfaToken, code }` or `{ mfaToken, recoveryCode }`. |
| POST | `/auth/refresh` | Rotates the refresh cookie. Replaying an old cookie revokes the session, except within 10 seconds of the rotation (two tabs racing), when it gets an access token and no new cookie. |
| POST | `/auth/logout` | Revokes the session. |
| POST | `/auth/passkeys/login/options`, `/auth/passkeys/login/verify` | WebAuthn sign in. Verify takes `{ challengeId, response }`. |
| GET | `/auth/sso/providers` | Enabled providers and their `startUrl`. |
| GET | `/auth/sso/:slug/start`, `/auth/sso/:slug/callback` | OIDC and OAuth2. `?next=/path` sets where to land. |
| GET | `/auth/saml/:slug/start`, `/auth/saml/:slug/metadata`; POST `/auth/saml/:slug/acs` | SAML 2.0 (SP-initiated). |
| POST | `/auth/token` | `{ key }` exchanges an API key for a 10 minute scoped token. |

## Current user (interactive)
| Method | Path | Notes |
|---|---|---|
| GET | `/me` | Profile and roles. Also accepts API key tokens. |
| GET | `/me/mfa` | TOTP state, passkey count, recovery codes left. |
| POST | `/me/mfa/totp/setup`, `/me/mfa/totp/confirm` | Returns `{ secret, otpauthUri }`, then `{ code }` returns recovery codes. |
| DELETE | `/me/mfa/totp` | Needs step-up: your password, or a TOTP or recovery code. |
| POST | `/me/mfa/recovery-codes/regenerate` | Replaces all codes. |
| GET, POST, DELETE | `/me/passkeys`, `/me/passkeys/register/options`, `/me/passkeys/register/verify`, `/me/passkeys/:id` | Cannot remove your last sign-in method. |
| GET, POST, DELETE | `/me/api-keys`, `/me/api-keys/:id` | Create takes `{ name, scopes[], expiresInDays? }`. The full key is returned once. Max active keys per user is enforced (409 `too_many_keys`). |
| GET, DELETE | `/me/sessions`, `/me/sessions/:id` | List and revoke devices. |
| GET | `/me/groups`, `/me/identities` | Group memberships, linked SSO identities. |

Scopes: `content:read`, `content:write`, `content:share`, `quiz:read`, `quiz:write`, `ai:use`, `notes:use`.

## Admin
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/overview` | Counts, deployment details and the settings below. |
| GET, PATCH | `/admin/settings` | PATCH `{ registrationOpen?: boolean or null, localUsersDisabled?: boolean }`. `registrationOpen: null` removes the override and uses `AUTH_REGISTRATION`. `localUsersDisabled: true` returns 409 `no_identity_provider` unless a provider is enabled. |
| POST | `/admin/users` | Create a local account: `{ email, displayName, roles?, method: "invite" or "password", password? }`. `invite` (default) returns a one-time `inviteUrl` valid 7 days. `password` returns a `temporaryPassword` (generated unless you pass one, 12 or more characters) that must be changed at first sign-in. Both are shown once. 409 `email_taken`, or `local_users_disabled`. |
| POST | `/admin/users/:id/invite` | New one-time link for a local account. Older links stop working. 409 `not_local_account` for SSO and SCIM users. |
| GET, PATCH | `/admin/users`, `/admin/users/:id` | PATCH `{ status: active or suspended, roles[] }`. Suspending revokes sessions. The last active admin cannot be removed. |
| GET, POST, DELETE | `/admin/groups`, `/admin/groups/:id` | |
| GET, POST, DELETE | `/admin/groups/:id/members`, `/admin/groups/:id/members/:userId` | |
| GET, POST, PATCH, DELETE | `/admin/idp-providers`, `/admin/idp-providers/:id` | See [identity.md](identity.md). `clientSecret` is write-only. |
| GET, POST, DELETE | `/admin/scim-tokens`, `/admin/scim-tokens/:id` | Token shown once on create. |
| GET | `/admin/audit` | Sign-ins, MFA changes, key use, admin actions. |

Roles: `platform_admin`, `org_admin`, `author`, `learner`.

### Connected apps and OAuth (MCP)
See [mcp.md](mcp.md#oauth-details-for-client-authors) for the flow. Routes marked interactive reject API key and connected-app tokens.

| Method | Path | Notes |
|---|---|---|
| GET | `/.well-known/oauth-authorization-server` | Metadata. Not under `/api/v1`. |
| POST | `/oauth/register` | Dynamic client registration. Not under `/api/v1`. |
| GET | `/oauth/authorize` | Starts authorization, hands off to the consent page `/connect`. |
| POST | `/oauth/token` | Code exchange and refresh. Form or JSON. |
| GET | `/oauth/clients/:id` | **Interactive.** Name and redirects of a registered client (consent page). |
| POST | `/oauth/consent` | **Interactive.** `{ clientId, redirectUri, scope[], state?, codeChallenge, approve }`. Returns `{ redirectTo }`. |
| GET, DELETE | `/me/mcp-connections`, `/me/mcp-connections/:id` | **Interactive.** Connected apps. DELETE revokes. |

### Sharing directory (interactive)
| Method | Path | Notes |
|---|---|---|
| GET | `/users/lookup?email=` | Exact email match returns `{ id, displayName }`, otherwise 404. Rate limited. |
| GET | `/groups` | Group ids and names, for choosing who to share with. |

## SCIM 2.0
Base `{ULTIMYR_PUBLIC_URL}/scim/v2`, bearer SCIM token. Supports `ServiceProviderConfig`, `ResourceTypes`, `Schemas`, and `Users` and `Groups` (list, get, create, replace, patch, delete) including Okta and Entra PATCH styles.

## Health and keys
| Path | Notes |
|---|---|
| `/healthz` | Process is up. Not under `/api/v1`. |
| `/readyz` | Database reachable. |
| `/.well-known/jwks.json` | Public signing key. |

# Content service API

Scopes: reads need `content:read`, writes `content:write`, sharing `content:share`. Unknown, deleted and forbidden objects all return 404. Lists take `limit` (1 to 100) and `offset`. See [content.md](content.md) for the model.

## Archives
| Method | Path | Notes |
|---|---|---|
| GET | `/archives` | Archives you own or can read. `?q=` text filter, `?scope=all\|mine\|shared`. |
| POST | `/archives` | Needs author, org admin or platform admin role. `{ title, overview?, vendor?, purchaseLinks?, validityMonths?, quickStats?, iconName?, visibility?, tags? }`. |
| GET, PATCH, DELETE | `/archives/:id` | GET includes the items you can see and your `relation`. DELETE is a soft delete. |
| POST | `/archives/:id/restore` | Restore from trash (owner). |
| GET | `/trash` | Your deleted archives and items. |
| POST, DELETE | `/archives/:id/icon` | POST raw `image/png`. See limits in content.md. |
| GET | `/assets/:id` | Icon bytes. No token needed (capability URL). |
| GET | `/archives/:id/export` | Archive JSON download. |

## Items, versions and cards
| Method | Path | Notes |
|---|---|---|
| POST | `/archives/:id/items` | `{ kind: guide\|deck\|quiz, title, summary?, markdown?, cards?, status?, source? }`. Source `ai` or `mcp` defaults to draft. |
| GET, PATCH, DELETE | `/items/:id` | PATCH `{ title?, summary?, markdown?, status?, order?, note? }`. A changed `markdown` makes a new version. |
| POST | `/items/:id/restore` | Restore a deleted item. |
| GET | `/items/:id/versions`, `/items/:id/versions/:no` | History and one version's body. |
| POST | `/items/:id/versions/:no/restore` | Copies that version forward as a new one. |
| GET, POST | `/items/:id/cards` | POST upserts up to 500 cards (`id` updates in place). |
| POST | `/items/:id/cards/delete` | `{ ids: [...] }` |
| PATCH | `/cards/:id` | |
| GET | `/items/:id/export?format=json\|markdown\|anki-csv` | |

## Resources and roadmaps
See [content.md](content.md#roadmaps-and-external-resources). Reading needs `viewer` on the archive; writing needs `editor`. Drafts are only returned to editors. Progress uses `content:write`, like the daily review.

| Method | Path | Notes |
|---|---|---|
| GET | `/archives/:id/resources` | `?kind=video\|playlist\|article\|course\|docs\|practice\|book\|podcast\|other`. |
| POST | `/archives/:id/resources` | `{ url, title, kind?, summary?, minutes?, tags?, status?, source? }`. `url` must be `https`. The same link updates the existing resource (200) instead of adding one (201). `kind` defaults to `video` for YouTube and Vimeo, otherwise `article`. `source` `ai` or `mcp` defaults to draft. |
| POST | `/archives/:id/resources/bulk` | `{ resources: [...], source? }`, up to 100, all or nothing. |
| GET, PATCH, DELETE | `/resources/:id` | PATCH takes any of the fields above plus `order`. DELETE also removes the resource from the roadmap. |
| GET | `/archives/:id/roadmap` | Stages and steps as you may see them, with your `done` ticks (steps carry `children`, and a parent has `progress`), `totals` (`percent`, `required`, `doneRequired`, `minutes`, `minutesLeft`) and `next`. `exists: false` when there is none (or it is a draft and you cannot edit). |
| PUT | `/archives/:id/roadmap` | Replaces the whole roadmap: `{ summary?, stages: [{ id?, title, summary?, steps: [{ id?, itemId \| resourceId \| resource \| milestone, note?, required?, minutes?, steps?: [...] }] }], status?, source? }`. Keep an `id` to keep its progress; anything left out is removed. `resource` is a new link added in the same call. Steps nest three levels deep (a fourth is a 400). Items and resources must belong to the archive. `source` `ai` or `mcp` defaults to draft. |
| POST | `/archives/:id/roadmap/outline` | `{ outline, mode?: append\|replace, status?, source? }`. Parses a text outline (see content.md) and adds it to the roadmap or replaces it. Returns the roadmap plus `warnings[]`. `append` keeps existing ids and progress. |
| PATCH | `/archives/:id/roadmap` | `{ status: draft\|published }`. |
| DELETE | `/archives/:id/roadmap` | Removes the roadmap and everyone's ticks on it. |
| PUT | `/roadmap/steps/:id/progress` | `{ done: boolean }`. Your own tick only. On a step with children it ticks every step under it. Returns new `totals` and `next`. |
| GET | `/roadmaps` | Up to 12 published roadmaps you can read, most recently worked on first, with `totals` and `next`. Used by the dashboard. |

## Sharing and access
| Method | Path | Notes |
|---|---|---|
| GET, POST | `/archives/:id/grants`, `/items/:id/grants` | Owner only. `{ subjectType: user\|group, subjectId, relation: attempt\|viewer\|editor\|owner, expiresAt? }`. Needs `content:share` to change. |
| DELETE | `/archives/:id/grants/:grantId`, `/items/:id/grants/:grantId` | |
| GET | `/access/archive/:id`, `/access/item/:id` | What can I do here? Any valid token. Used by other services. |

## Search and import
| Method | Path | Notes |
|---|---|---|
| GET | `/search?q=&archive=&type=` | `type` is `archive`, `item`, `section`, `card` or `resource` (resource hits carry the `url`). |
| POST | `/import` | `{ format: archive-json\|markdown\|anki-csv, content, archiveId?, title? }` |

# Quiz service API

Scopes: reads need `quiz:read`, writes (including taking an attempt) need `quiz:write`. Who may attempt or edit a quiz is decided by the content service from the quiz item's sharing; unknown or forbidden objects return 404. Question keys are only ever returned to editors. See [quiz.md](quiz.md) for behaviour.

## Questions and settings (editors)
| Method | Path | Notes |
|---|---|---|
| GET, POST | `/quizzes/:itemId/questions` | List (with keys and drafts) or add one. Body: `type`, `stem`, `payload`, `key`, optional `explanation`, `difficulty`, `domain`, `weight`, `isPretest`, `source`, `status`. `ai` and `mcp` sources default to `draft`. |
| POST | `/quizzes/:itemId/questions/bulk` | `{ questions: [...] }`, up to 200, all or nothing. Errors name the failing `index`. |
| GET, PATCH, DELETE | `/questions/:id` | To change `type`, `payload` or `key`, send all three together. |
| GET, PUT | `/quizzes/:itemId/config` | `mode`, `timeLimitSeconds`, `questionCount`, `shuffleQuestions`, `shuffleOptions`, `scoringProfileId`, `graceSeconds`. GET is open to anyone who may attempt (no keys). |

## Scoring profiles
| Method | Path | Notes |
|---|---|---|
| GET | `/scoring-profiles` | Built-in plus your own. Each shows `fidelity`, `source`, `checksum`. |
| GET | `/scoring-profiles/:id` | |
| POST | `/scoring-profiles` | `{ definition }`. Authors only. Same name makes the next version. Profiles never change once saved. |
| POST | `/scoring-profiles/simulate` | `{ profile, questions, responses }` returns the full grade without saving anything. |
| POST | `/scoring-profiles/:id/simulate` | Same, with a saved profile. |

## Attempts
| Method | Path | Notes |
|---|---|---|
| POST | `/quizzes/:itemId/attempts` | `{ mode?: "practice", includeDrafts?, restart?, extraTimePct?: 0, 25, 50 or 100 }`. 201 with the questions (no keys), or 200 with `resumed: true` if one is open. 409 `no_questions` if nothing is published. Rate limited. |
| GET | `/attempts/:id` | Resume. Includes `serverTime` and `deadlineAt`. A past-deadline attempt is closed and graded on the spot. |
| PUT | `/attempts/:id/items/:questionId` | `{ response?, flagged?, timeMs? }`. 409 `attempt_closed` after the deadline plus grace, 409 `already_revealed` for a checked practice answer. |
| POST | `/attempts/:id/items/:questionId/check` | Practice only: grades the question and returns outcome, key and explanation. |
| POST | `/attempts/:id/submit` | Grades once. Repeating returns the stored result. |
| GET | `/attempts/:id/review` | Closed attempts only (409 `attempt_open`). |
| GET | `/attempts/:id/events` | Server-sent events for an open attempt: `tick` (`serverTime`, `deadlineAt`, `remainingMs`) every 10 s, then `closed`. Ends after 5 minutes; reconnect. |
| GET | `/quizzes/:itemId/attempts`, `/attempts` | Your own attempts, newest first. |

Response shapes: `mcq` `{ choice }`, `multi` `{ choices }`, `fib` `{ blanks }`, `dnd` `{ mapping }`, `pbq` `{ state }`.

## Progress and goals (quiz service)
| Method | Path | Notes |
|---|---|---|
| GET | `/analytics?archive=&days=` | `days` 1 to 365 (default 30). Returns `summary`, `daily`, `domains`, `weak`, and, when `archive` is given, `readiness` and `goal`. Your own data only. |
| GET | `/goals` | All your goals. |
| GET, PUT, DELETE | `/goals/:archiveId` | PUT `{ targetBp, targetDate? }` (`targetBp` 1 to 10000, so 8000 is 80%). GET returns `{ goal: null }` when none. |

## AI gateway
See [ai.md](ai.md#api) for the full list: `/ai/status`, `/ai/credentials`, `/ai/preferences`, `/ai/generate`, `/ai/jobs`, `/ai/agent/threads`, `/ai/me`. Scope `ai:use`.

## Notes service
Bridge to the person's Fast Note Sync vault (see [notes.md](notes.md#sync-with-obsidian)). Scope `notes:use`. Answers 503 `notes_disabled` when `FNS_URL` or the vault key is not set. The token is write-only.

| Method | Path | Notes |
|---|---|---|
| GET | `/notes/connection` | `{ enabled, server, connected, vault }` |
| PUT | `/notes/connection` | `{ token, vault }`. Checks the token and that the vault exists (400 `vault_not_found` lists the vaults), then stores the token sealed. |
| DELETE | `/notes/connection` | Removes the connection and the step to note mapping. Notes in the vault stay. |
| GET | `/notes/archives/:id` | `{ enabled, connected, scaffolded, steps: { [stepId]: { path, obsidianUrl } } }` |
| POST | `/notes/archives/:id/scaffold` | Creates the index and one note per step with create only. Returns `{ total, created, existing, failed, indexUrl }`. Safe to repeat. |
| GET | `/notes/steps/:stepId` | `{ path, exists, content, hash, obsidianUrl }` |
| PUT | `/notes/steps/:stepId` | `{ content, baseHash }`. 409 `conflict` if the note changed since `hash`. |
| POST | `/notes/steps/:stepId/append` | `{ text }`. Adds text to the end of the note; never replaces anything. |
| GET | `/notes/steps/:stepId/flashcards` | `{ cards: [{ front, back }], skipped }` from the `Question :: Answer` lines under `## Flashcards`. |
| POST | `/notes/steps/:stepId/status` | `{ status: todo, reading or done }`. Patches only the `status` property. |

Errors: 409 `not_connected`, `fns_token_rejected`, `conflict`; 404 `no_note` (step has no note yet); 502 `fns_unreachable`.

## Daily review (content service)
Scopes: reads `content:read`, reviews and settings `content:write`. Only published decks the caller can read are included.

| Method | Path | Notes |
|---|---|---|
| GET | `/study/queue?archive=&deck=&limit=` | Due cards first, then new cards up to today's allowance. Each card carries `next`: what every rating would schedule. |
| POST | `/study/review` | `{ cardId, rating: 1..4, durationMs? }`. Returns the new `state`, `due` and `scheduledDays`. |
| GET | `/study/stats?archive=` | `learning`, `review`, `dueNow`, `reviewedToday`, `retentionBp`, `forecast` (7 days). |
| GET, PUT | `/study/settings` | `desiredRetention` (0.7 to 0.99) and `newPerDay` (0 to 500). |
