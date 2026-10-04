# API reference

The auth service is documented first, then the content service, then the quiz service. Each service also answers `/healthz` and `/readyz`.

# Auth service API

Base path: `/api/v1` (the service also answers the same routes under `/v1`). JSON in and out. Errors look like `{ "error": "code", "issues": ["..."] }`.

**Authentication:** `Authorization: Bearer <access token>`. Access tokens are EdDSA JWTs valid 10 minutes. Verify them with the public key at `/.well-known/jwks.json` (issuer `ultimyr-auth`, audience `ultimyr`). Claims: `sub`, `sid`, `roles`, `scopes`, `amr`.

Browser sessions get a rotating httpOnly refresh cookie (`ultimyr_rt`, 30 days). API keys get scoped tokens with no cookie. Routes marked **interactive** reject API key tokens. Routes marked **admin** need the `platform_admin` role. Sensitive routes are rate limited (default 10 per minute per client) and return 429.

## Sign in
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | `{ displayName, email, password }`. First account becomes admin. Honors `AUTH_REGISTRATION`. |
| POST | `/auth/login` | `{ email, password }`. Returns a session, or `{ mfaRequired, mfaToken, methods }` when TOTP is on. |
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
| GET, DELETE | `/me/sessions`, `/me/sessions/:id` | List and revoke devices. |
| GET | `/me/groups`, `/me/identities` | Group memberships, linked SSO identities. |

Scopes: `content:read`, `content:write`, `content:share`, `quiz:read`, `quiz:write`, `ai:use`.

## Admin
| Method | Path | Notes |
|---|---|---|
| GET, PATCH | `/admin/users`, `/admin/users/:id` | PATCH `{ status: active or suspended, roles[] }`. Suspending revokes sessions. The last active admin cannot be removed. |
| GET, POST, DELETE | `/admin/groups`, `/admin/groups/:id` | |
| GET, POST, DELETE | `/admin/groups/:id/members`, `/admin/groups/:id/members/:userId` | |
| GET, POST, PATCH, DELETE | `/admin/idp-providers`, `/admin/idp-providers/:id` | See [identity.md](identity.md). `clientSecret` is write-only. |
| GET, POST, DELETE | `/admin/scim-tokens`, `/admin/scim-tokens/:id` | Token shown once on create. |
| GET | `/admin/audit` | Sign-ins, MFA changes, key use, admin actions. |

Roles: `platform_admin`, `org_admin`, `author`, `learner`.

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

## Sharing and access
| Method | Path | Notes |
|---|---|---|
| GET, POST | `/archives/:id/grants`, `/items/:id/grants` | Owner only. `{ subjectType: user\|group, subjectId, relation: attempt\|viewer\|editor\|owner, expiresAt? }`. Needs `content:share` to change. |
| DELETE | `/archives/:id/grants/:grantId`, `/items/:id/grants/:grantId` | |
| GET | `/access/archive/:id`, `/access/item/:id` | What can I do here? Any valid token. Used by other services. |

## Search and import
| Method | Path | Notes |
|---|---|---|
| GET | `/search?q=&archive=&type=` | `type` is `archive`, `item`, `section` or `card`. |
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
| POST | `/quizzes/:itemId/attempts` | `{ mode?: "practice", includeDrafts?, restart? }`. 201 with the questions (no keys), or 200 with `resumed: true` if one is open. 409 `no_questions` if nothing is published. Rate limited. |
| GET | `/attempts/:id` | Resume. Includes `serverTime` and `deadlineAt`. A past-deadline attempt is closed and graded on the spot. |
| PUT | `/attempts/:id/items/:questionId` | `{ response?, flagged?, timeMs? }`. 409 `attempt_closed` after the deadline plus grace, 409 `already_revealed` for a checked practice answer. |
| POST | `/attempts/:id/items/:questionId/check` | Practice only: grades the question and returns outcome, key and explanation. |
| POST | `/attempts/:id/submit` | Grades once. Repeating returns the stored result. |
| GET | `/attempts/:id/review` | Closed attempts only (409 `attempt_open`). |
| GET | `/quizzes/:itemId/attempts`, `/attempts` | Your own attempts, newest first. |

Response shapes: `mcq` `{ choice }`, `multi` `{ choices }`, `fib` `{ blanks }`, `dnd` `{ mapping }`, `pbq` `{ state }`.
