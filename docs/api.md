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
| POST | `/auth/refresh` | Rotates the refresh cookie. Replaying an old cookie revokes the session. |
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
| GET, DELETE | `/me/sessions`, `/me/sessions/:id` | List and revoke devices. `DELETE /me/sessions` signs out every device except the one asking and returns `{ revoked }`. |
| GET | `/me/groups`, `/me/identities` | Group memberships, linked SSO identities. |

Scopes: `content:read`, `content:write`, `content:share`, `quiz:read`, `quiz:write`, `ai:use`, `notes:use`.

## Admin
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/overview` | Counts, deployment details and the settings below. |
| GET | `/admin/services` | Admin only. Whether each service answers `/readyz` (auth is always listed): `[{ name, ok, ms, problem? }]`. The addresses come from the auth service's `CONTENT_URL`, `QUIZ_URL`, `AI_URL`, `MCP_URL` and `NOTES_URL`, never from the request; unset ones are skipped. Two second timeout each. |
| GET | `/admin/about` | Running version and commit, latest GitHub release, commits behind main, and the matching changelog section. `?refresh=1` re-checks (at most every 30 seconds). Returns `status: "unknown"` when GitHub is unreachable and `"disabled"` when `ULTIMYR_UPDATE_CHECK=false`. |
| GET, PATCH | `/admin/settings` | PATCH `{ registrationOpen?: boolean or null, localUsersDisabled?: boolean }`. `registrationOpen: null` removes the override and uses `AUTH_REGISTRATION`. `localUsersDisabled: true` returns 409 `no_identity_provider` unless a provider is enabled. |
| POST | `/admin/users` | Create a local account: `{ email, displayName, roles?, method: "invite" or "password", password? }`. `invite` (default) returns a one-time `inviteUrl` valid 7 days. `password` returns a `temporaryPassword` (generated unless you pass one, 12 or more characters) that must be changed at first sign-in. Both are shown once. 409 `email_taken`, or `local_users_disabled`. |
| POST | `/admin/users/:id/invite` | New one-time link for a local account. Older links stop working. 409 `not_local_account` for SSO and SCIM users. |
| GET, PATCH | `/admin/users`, `/admin/users/:id` | GET takes `?q=`, `?limit=` (1 to 200, up to 10000 with `format=csv`), `?offset=` and `?format=csv` (email, name, status, created_via, roles, created; no secrets; formula-looking cells are neutralised). PATCH `{ status: active or suspended, roles[] }`. Suspending revokes sessions. The last active admin cannot be removed. |
| GET, POST, DELETE | `/admin/groups`, `/admin/groups/:id` | |
| GET, POST, DELETE | `/admin/groups/:id/members`, `/admin/groups/:id/members/:userId` | |
| GET, POST, PATCH, DELETE | `/admin/idp-providers`, `/admin/idp-providers/:id` | See [identity.md](identity.md). `clientSecret` is write-only. |
| GET, POST, DELETE | `/admin/scim-tokens`, `/admin/scim-tokens/:id` | Token shown once on create. |
| GET | `/admin/audit` | Sign-ins, MFA changes, key use, admin actions, newest first. `?limit=` (1 to 500, up to 5000 with `format=csv`), `?action=`, `?before=<id>` for the next page, `?format=csv` for a spreadsheet download (cells that start with `=`, `+`, `-` or `@` are prefixed so they are never run as formulas). |
| GET | `/admin/audit/actions` | Every action name in the log, for filters. |

Roles: `platform_admin`, `org_admin`, `author`, `learner`, `curriculum_admin` (full access to every course and its settings, and group access; no installation admin settings).

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

## Tags and icons (content service)
See [tagging.md](tagging.md). Reading needs `viewer` on the archive; writing needs `editor` and `content:write`. Tags are `namespace:value`; bare words are normalized (`AI` becomes `topic:ai`).

| Method | Path | Notes |
|---|---|---|
| GET | `/tags/vocabulary` | Namespaces and values with synonyms and curated icons. |
| GET | `/icons` | `?query=&tag=&limit=&offset=`. The bundled Lucide library (`totalInLibrary`). Each icon has `tags` (what it depicts) and `suggestFor` (the vocabulary tags it suits). With `tag`, ordered best first for that tag. |
| GET | `/icons/:name` | One icon's info. 404 if not in the library. |
| POST | `/icons/suggest` | `{ tags: (string \| { tag, weight? })[], limit? }` returns `suggestions: [{ name, score, matched }]`. Weight 0 to 1 counts a tag less. |
| GET | `/archives/:id/tags` | `?kind=&tag=`. `summary` (count per tag) and `targets: [{ kind, id, title, tags, derived, inferred, icon? }]` for the archive, stages, steps, resources, items and objectives. Viewers do not see drafts. |
| PUT | `/archives/:id/tags` | `{ targets: [{ kind: archive\|stage\|step\|resource\|item\|objective, id, tags }] }` sets the exact list for each (empty clears), up to 300 targets and 30 tags each. Every id must belong to the archive (400 otherwise). Returns `stored` and `iconChanges`. |
| GET | `/archives/:id/icon-suggestions` | `?kind=archive\|stage\|step&id=&limit=`. Ranked icons for that target with the weighted tags used. |
| PUT | `/archives/:id/icons` | `{ targets: [{ kind, id, icon: name \| null }] }`. A name is the person's choice (`source: user`, never replaced automatically); `null` hands it back to automatic assignment. |
| POST | `/archives/:id/icons/auto` | Re-run automatic assignment. Returns `iconChanges`. Never touches a `user` icon. |

Archives, roadmap stages and steps now return `icon: { name, source }` (`source` is `auto`, `user`, or `default` and `none` when nothing is set), and stages, steps and resources in the roadmap return `tagSet`. `PATCH /archives/:id` accepts `iconName: null` to return to automatic assignment, and rejects names that are not in the library.

## Sharing and access
| Method | Path | Notes |
|---|---|---|
| GET, POST | `/archives/:id/grants`, `/items/:id/grants` | Owner only. `{ subjectType: user\|group, subjectId, relation: attempt\|viewer\|editor\|owner, expiresAt? }`. Needs `content:share` to change. |
| DELETE | `/archives/:id/grants/:grantId`, `/items/:id/grants/:grantId` | |
| GET | `/group-access/archives` | Every archive with `access` (`everyone` or `restricted`) and `groupGrants`. `platform_admin` or `curriculum_admin`. Needs `content:read`. |
| GET | `/group-access/groups/:groupId` | One group's `level` (`none`, `view`, `manage`, plus legacy `attempt`, `owner`) on every archive. |
| PUT | `/group-access/archives/:id/groups/:groupId` | `{ level: none\|view\|manage, expiresAt? }`. `view` is a `viewer` grant, `manage` is `editor`. Replaces the group's grant on that archive. Needs `content:share`. |
| PUT | `/group-access/archives/:id/access` | `{ mode: everyone\|restricted }`. |
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

## Credentials (content service)
Private to the owner. Dates are `YYYY-MM-DD`. See [prep.md](prep.md).

| Method | Path | Notes |
|---|---|---|
| GET, POST | `/credentials` | POST `{ name, issuer?, status: planned\|scheduled\|earned\|retired, archiveId?, examDate?, voucherCode?, voucherExpires?, earnedOn?, expiresOn?, renewalAlertDays?, ceuRequired?, ceuUnit?, credentialId?, verifyUrl?, notes? }`. |
| GET | `/credentials/alerts` | Computed from your dates: `exam_today`, `exam_soon`, `exam_past`, `voucher_expiring`, `voucher_expired`, `renewal_due`, `expired`, `ceu_short`, each with `severity`, `date`, `daysLeft`, `message`. |
| GET, PATCH, DELETE | `/credentials/:id` | GET includes CEU entries and the total in the current cycle. |
| POST | `/credentials/:id/ceu` | `{ title, units, earnedOn, category?, evidenceUrl? }`. |
| PATCH, DELETE | `/credentials/:id/ceu/:entryId` | |

## Objectives and coverage
| Method | Path | Notes |
|---|---|---|
| GET | `/archives/:id/objectives` | Two-level tree (domain, topic) with `weightBp` and linked counts rolled up (distinct material counted once). |
| PUT | `/archives/:id/objectives` | Replaces the tree (editor). |
| POST | `/archives/:id/objectives/import` | `{ outline, replace? }`. Outline lines: `## 1.0 Domain (15%)` then bullets. Merges by code or title. |
| GET, PUT | `/archives/:id/links` | Links from objectives to `item`, `card` or `resource` ids. |
| GET | `/analytics/objectives?archive=` | Quiz service. Per objective: questions, drafts, answered, correct, `accuracyBp`, plus `unmapped`. |

`GET /access/archive/:id` also returns `quizzes: [{ id, title, status, canAttempt, canWrite }]`.

## Drills and plan (quiz service)
| Method | Path | Notes |
|---|---|---|
| POST | `/drills` | `{ archiveId, count: 3 to 50, focus: mixed\|weak\|missed, objectiveId?, restart? }`. Resumes an open drill unless `restart`. 409 `no_questions` or `nothing_to_drill`. A drill is an attempt with `kind: "drill"`, so the attempt routes above apply. Drills do not feed the readiness estimate. |
| GET | `/plan?archive=&examDate=&minutes=&mode=` | Phases, daily tasks (up to 28 days plus exam day), advice and an exam-day checklist. |

## AI gateway
See [ai.md](ai.md#api) for the full list: `/ai/status`, `/ai/credentials`, `/ai/preferences`, `/ai/generate`, `/ai/jobs`, `/ai/agent/threads`, `/ai/me`. Scope `ai:use`.

## Notes service
A person's step notes, kept in Ultimyr (schema `notes`) and optionally mirrored to their Fast Note Sync vault (see [notes.md](notes.md)). Scope `notes:use`. Note routes work without any vault. Vault routes answer 503 `notes_disabled` (with `reason`: `no_key` or `no_server`) when the vault key or the server address is missing, and 503 `notes_not_migrated` if the notes tables are missing. The vault token is write-only. Step routes take `archive` (query, or in the body) the first time a step is used; it is remembered afterwards. Notes belong to leaf steps.

`mirror` in a response is `off` (no vault), `synced`, `pending`, `unreachable` or `conflict` (then `remote` holds the vault's text).

| Method | Path | Notes |
|---|---|---|
| GET | `/notes/steps/:stepId?archive=` | `{ exists, content, hash, mirror, remote?, pulled?, obsidianUrl, path }`. With a vault it first brings the two copies in step (text changed only in the vault is taken in). 404 `not_found` if the step is not in an archive the caller can read, 400 `archive_required`. |
| PUT | `/notes/steps/:stepId` | `{ archive?, content, baseHash }`. Saves in Ultimyr, then mirrors. 409 `conflict` if the saved note changed since `baseHash`. Returns the same shape as GET. |
| POST | `/notes/steps/:stepId/append` | `{ archive?, text }`. Adds text to the end; never replaces anything. |
| POST | `/notes/steps/:stepId/resolve` | `{ archive?, keep: mine\|obsidian }` after `mirror: conflict`. |
| GET | `/notes/steps/:stepId/flashcards` | `{ cards: [{ front, back }], skipped }` from the `Question :: Answer` lines under `## Flashcards`. |
| POST | `/notes/steps/:stepId/status` | `{ status: todo, reading or done }`. Patches only the `status` property of the vault copy, best effort. |
| GET | `/notes/archives/:id` | `{ mirrorAvailable, connected, prefs, steps: { [stepId]: { path, obsidianUrl } } }` for steps that have note text. |
| POST | `/notes/sync` | Brings every note in step with the vault. Returns `{ total, synced, pulled, conflicts, failed }`. |
| GET | `/notes/admin` | Platform administrators. `{ fnsUrl, source: env\|admin\|null, keyPresent, canEdit }`. |
| PUT | `/notes/admin` | Platform administrators. `{ fnsUrl }` (null removes). Probes the server first: 400 `invalid_address` or `server_unreachable`; 409 `set_by_environment` when `FNS_URL` is set. |
| GET | `/notes/connection` | `{ enabled, reason, server, connected, vault, admin, prefs }` (`enabled` means the vault can be connected). |
| POST | `/notes/connection/check` | `{ token }` returns `{ vaults }` without saving. |
| PUT | `/notes/connection` | `{ token, vault }`. Checks the token and vault (400 `vault_not_found`), then stores the token sealed. |
| DELETE | `/notes/connection` | Removes the connection. Notes stay in Ultimyr and in the vault. |
| GET, PUT | `/notes/preferences` | `{ rootFolder }` (the vault folder, default `Ultimyr`). `editor` and `pane` are accepted for older clients and ignored. |
| GET | `/notes/folders` | Existing vault folders (three levels) to suggest as the root. |
| GET | `/notes/archives/:id/text` | `{ notes: [{ stepId, content }] }`: your own non-empty note text for the archive (newest first, up to 400), used for note search and the stage digest. |
| GET | `/notes/archives/:id/preview?root=` | The vault files a full sync would write. Writes nothing. |
| POST | `/notes/archives/:id/scaffold` | Creates empty template notes for every step in the vault (create only). Not needed for normal use. |

Errors: 409 `not_connected`, `fns_token_rejected`, `conflict`; 502 `fns_unreachable`.

## Daily review (content service)
Scopes: reads `content:read`, reviews and settings `content:write`. Only published decks the caller can read are included.

| Method | Path | Notes |
|---|---|---|
| GET | `/study/queue?archive=&deck=&limit=` | Due cards first, then new cards up to today's allowance. Each card carries `next`: what every rating would schedule. |
| POST | `/study/review` | `{ cardId, rating: 1..4, durationMs? }`. Returns `reviewId`, the new `state`, `due` and `scheduledDays`. |
| POST | `/study/review/undo` | `{ reviewId }`. Restores the schedule the review replaced (or makes a first review new again) and removes it from your history. 404 if it is not your review, 409 `cannot_undo` if the card was reviewed again since or the review predates undo. |
| GET | `/study/export` | Your own review history as CSV (`reviewed_at, course, deck, card, rating, was_new, scheduled_days, seconds`), newest first, up to 100,000 rows. Cells that start with `=`, `+`, `-` or `@` get a leading apostrophe so spreadsheets do not run them. |
| GET | `/study/stats?archive=` | `learning`, `review`, `dueNow`, `reviewedToday`, `retentionBp`, `forecast` (7 days). |
| GET, PUT | `/study/settings` | `desiredRetention` (0.7 to 0.99) and `newPerDay` (0 to 500). |
