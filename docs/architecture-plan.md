# Ultimyr: Architectural Plan (v1, pre-code)

**Status:** Proposal for approval. No code written yet.
**Date:** 2026-10-04

## 0. TL;DR (the decisions that matter)

- **Language:** TypeScript end to end. One toolchain, shared types, and the official MCP TypeScript SDK.
- **Shape:** A pnpm monorepo with **6 deployable services** plus shared packages. Each service owns its own Postgres schema and DB role. No cross-schema joins.
- **Frontend:** Next.js (React) + Tailwind + shadcn/ui + lucide-react + Recharts.
- **Backend:** Fastify services (not NestJS, lighter and faster). Drizzle ORM. Zod for contracts, with OpenAPI generated from Zod.
- **Service comms:** REST (OpenAPI) for synchronous calls, a Postgres-backed outbox + job queue for async. NATS is a documented upgrade path, not a day-one dependency.
- **Auth model:** Auth service issues short-lived EdDSA JWTs, verified locally by every service via JWKS. Content sharing uses a small ReBAC (relationship tuple) engine.
- **AI vault:** Envelope encryption with AES-256-GCM, per-user data keys, a key-encryption key (KEK) that only the AI Gateway can load. **I judge this reliably architectable, so on-platform AI stays in scope** (reasoning in section 3.4).
- **Scoring:** A pure, deterministic, versioned scoring library using integer or decimal math, driven by declarative "scoring profiles" and verified with golden test vectors.
- **Open question for you:** What "non-token Gemini" means (see section 1.4). I have an assumption and a fallback.

---

## 1. Tech Stack

### 1.1 Stack at a glance

| Layer | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | Shared packages, cached builds, per-service Docker targets |
| Frontend | Next.js (App Router), React, TypeScript | SSR for the splash page, SPA feel for study flows |
| Styling | Tailwind CSS + shadcn/ui (Radix primitives) | Minimal, accessible, easy to restyle to the Ultimyr look |
| Icons | `lucide-react` only | Brief requires Lucide exclusively |
| Charts | Recharts (fallback: uPlot for dense series) | Small, declarative, good enough for trends and goals |
| State/data | TanStack Query + Zod-typed API client (generated) | Cache, retries, optimistic edits |
| Service framework | Fastify + `fastify-type-provider-zod` | Fast, schema-first, tiny footprint |
| ORM | **Drizzle ORM** + drizzle-kit migrations | SQL-close, light, per-schema support, no heavy runtime |
| DB | PostgreSQL 16+ (with `pgcrypto`, `pg_trgm`, optional `pgvector`) | One datastore for relational, search, jobs |
| Jobs/events | Postgres outbox + `pg-boss` queue | No extra broker to operate |
| Cache/rate limit | Redis (optional profile) | Rate limits, SSE fanout; services degrade to in-memory if absent |
| Edge/proxy | Traefik | Routing, TLS, forward-auth, labels in compose |
| Auth libs | `@simplewebauthn/server`, `otplib`, `openid-client`, `@node-saml/node-saml`, `jose` | Vetted libraries for each protocol, no hand-rolled crypto |
| MCP | `@modelcontextprotocol/sdk` (Streamable HTTP) | Spec-compliant transport and auth flow |
| Observability | OpenTelemetry + pino logs, optional Prometheus/Grafana profile | Same trace ID across services |
| Testing | Vitest, Playwright, Testcontainers, k6 (load) | Real Postgres in tests |

### 1.2 Why TypeScript everywhere (trade-off)

- **Pro:** Shared Zod schemas between frontend, services, and MCP. One language for contributors. The scoring library runs identically in the browser (practice mode preview) and server (authoritative grading).
- **Con:** Python has a richer AI ecosystem. Mitigation: the AI Gateway only needs HTTP clients to providers, which TS handles fine. If a Python-only capability is needed later, it can be added as a new service behind the same gateway contract.

### 1.3 Auth: build vs buy (trade-off)

- **Recommended: build a thin Auth service on vetted libraries.** You need SCIM groups feeding per-document sharing and per-user API keys and MCP tokens, and these are tightly coupled to Ultimyr's domain.
- **Alternative: embed Keycloak or Zitadel.** Faster on SAML/OIDC, but adds a heavy Java service, a second user store to sync, and awkward fit for fine-grained sharing. Reasonable if you want enterprise IAM sooner than custom effort allows.
- **Decision gate:** Phase 2 starts with a short spike to confirm the custom path. Switching later is contained, because other services only depend on the JWT and the `/auth` contract.

### 1.4 Assumption to confirm: "non-token Gemini"

I read this as: users connect Gemini **without pasting an API key**, most likely via **Google OAuth consent** with a refresh token stored in the vault. Concerns: Google restricts which Gemini scopes are available to third-party OAuth apps, and this may depend on Google Cloud verification.

- **Plan:** Provider adapters support two credential kinds: `api_key` and `oauth_refresh`. Phase 4 begins with a feasibility check of Gemini via OAuth.
- **Fallback if not viable:** Ship Gemini with a user-supplied API key (free tier keys cost nothing) and keep OAuth as a later enhancement. Tell me if you meant something else (a local model, Gemini CLI auth, etc.).

---

## 2. Service Boundaries

### 2.1 Services

| Service | Responsibility | Owns (schema) | Scales for |
|---|---|---|---|
| **web** | Next.js UI, splash page, BFF for cookies/CSRF | none | Static + SSR |
| **auth** | Users, sessions, local login, OIDC/OAuth/SAML, passkeys, TOTP, SCIM 2.0, groups, API keys, OAuth server for MCP | `auth` | Login bursts |
| **content** | Master items, sub-items (guides, decks, quizzes), versioning, sharing grants, tags, search | `content` | Reads |
| **quiz** | Question banks, attempts, exam simulator, scoring profiles, analytics, goals | `quiz` | Exam sessions |
| **ai-gateway** | Provider adapters, user credential vault, generation jobs, in-app agent streaming | `ai` | Streaming, long jobs |
| **mcp** | MCP server (Streamable HTTP), translates tool calls to service REST calls as the user | none | Headless AI clients |
| **worker** | Runs queued jobs (generation, imports, exports, analytics rollups). Same image as services, different entrypoint | shared queue tables | Background load |

**Why `mcp` is separate:** it is a protocol adapter with its own auth surface and rate limits. It holds no data and no business logic, only calls the public service APIs with the user's identity. This keeps API/MCP-only deployments cheap (run without `web`).

### 2.2 Communication

- **Synchronous:** REST with OpenAPI contracts, versioned under `/v1`. Service to service calls carry the **user's JWT plus a service token**, so downstream authorization always sees the real user.
- **Asynchronous:** Transactional **outbox** table per service, a relay publishes to `pg-boss` queues. Events are versioned JSON (`quiz.attempt.completed.v1`, `content.item.shared.v1`, `auth.user.deprovisioned.v1`).
- **Streaming:** Server-Sent Events for AI agent tokens and exam timer sync.
- **gRPC:** Not adopted. REST + generated clients is simpler for external API consumers and MCP, and there is no latency need yet.
- **No shared database access:** Services never read another service's tables. They call its API or consume its events (for example, `content` keeps a local copy of group membership via `auth` events).

### 2.3 Identity propagation

1. User logs in. Auth issues an **access JWT (10 min, EdDSA)** and a rotating **refresh token (httpOnly cookie)**.
2. Claims: `sub`, `org`, `roles`, `scopes`, `groups_hash`, `sid`. Services verify via cached JWKS, no per-request call to auth.
3. API keys and MCP tokens are exchanged at auth for the same JWT shape, with a **narrower scope set** (for example `content:read`, `content:write`, `quiz:read`).
4. Revocation: `sid` revocation list pushed by events (short TTL cache), so a disabled SCIM user is cut off within seconds.

### 2.4 Authorization model

- **Roles (coarse):** `platform_admin`, `org_admin`, `author`, `learner`.
- **Scopes (token level):** cap what a given token can do, even for an admin (least privilege for API keys).
- **Sharing (fine):** Relationship tuples in `content.grants`: `(subject, relation, object)`.
  - Subject: `user:<id>` or `group:<id>` (IdP-synced groups work directly).
  - Relation: `viewer`, `editor`, `owner` (maps to read/write/edit-and-reshare). Optional `attempt` for exam-only access.
  - Object: master item, guide, deck, quiz, or folder. Grants **inherit down** from master item to sub-items unless explicitly overridden.
- A single `can(user, relation, object)` function in a shared package, backed by one recursive SQL query. Fast enough without a dedicated Zanzibar system, and replaceable by OpenFGA later.

### 2.5 Failure and isolation rules

- Each service starts without the others (health vs readiness checks).
- Timeouts and retries with jitter on every outbound call. Circuit breaker on the AI provider calls.
- AI outages never block studying. The AI Gateway can be fully down and the rest still works.

---

## 3. Database Schema

PostgreSQL, one database, **one schema per service**, each with its own DB role that can only touch its schema. IDs are UUIDv7. Every table has `created_at`, `updated_at`; soft delete via `deleted_at` where users could regret it.

### 3.1 `auth` schema

- `users` (id, email citext unique, display_name, password_hash nullable (argon2id), status [active, suspended, deprovisioned], external_id, locale, created_via [local, sso, scim])
- `identities` (user_id, provider_id, subject, raw_claims_json) for linked OIDC/OAuth/SAML logins
- `idp_providers` (id, kind [oidc, oauth2, saml], name, config_json, secret_ref, jit_provisioning, group_claim_map, enabled). Provider secrets are encrypted with the same envelope scheme, instance-scoped.
- `sessions` (id, user_id, refresh_hash, ua, ip, created_at, last_seen_at, revoked_at)
- `passkeys` (id, user_id, credential_id, public_key, counter, transports, backup_state, name)
- `totp_factors` (user_id, secret_enc, confirmed_at), `recovery_codes` (user_id, code_hash, used_at)
- `groups` (id, name, source [local, scim], external_id), `group_members` (group_id, user_id)
- `roles`, `role_assignments` (user_id or group_id, role, scope_object nullable)
- `api_keys` (id, user_id, name, prefix, key_hash [HMAC-SHA256 with server pepper], scopes[], expires_at, last_used_at, revoked_at). Full key shown **once**.
- `mcp_connections` (id, user_id, client_name, scopes[], created_via [oauth, key], last_used_at, revoked_at)
- `oauth_clients`, `oauth_grants` for MCP dynamic client registration and consent
- `scim_tokens` (id, hashed token, created_by, last_used_at)
- `audit_log` (actor, action, target, ip, ts, metadata). Append-only, hash chained optionally.

### 3.2 `content` schema

- `master_items` (id, owner_id, slug, title, overview, vendor, purchase_links jsonb[], validity_months, quick_stats jsonb [passing score, duration, question count, cost, difficulty], icon_kind [lucide, upload], icon_name, icon_asset_id, visibility [private, shared, org, public], scoring_profile_id)
- `assets` (id, owner_id, kind, mime, bytes, sha256, storage_key) for uploaded PNG icons, with validation: PNG only, alpha channel required, size and dimension limits, re-encoded server-side to strip metadata
- `sub_items` (id, master_item_id, kind [guide, deck, quiz], title, summary, owner_id, current_version_id, ai_status [none, draft, reviewed])
- `item_versions` (id, sub_item_id, version_no, body jsonb, author_id, source [human, ai, mcp, import], created_at). Every edit is a version, so AI or MCP writes are reversible.
- `guide_sections` (version_id, ord, heading, md_body) for fine-grained references and deep links
- `cards` (id, deck_id, front, back, hint, tags[], media jsonb)
- `tags`, `item_tags`; `folders`; `bookmarks`; `comments` (optional)
- `grants` (id, object_type, object_id, subject_type, subject_id, relation, created_by, expires_at)
- `group_membership_cache` (group_id, user_id), fed by `auth` events
- `search_index` (generated tsvector + trigram on titles, headings, card text; optional pgvector embeddings in a later phase)

### 3.3 `quiz` schema

- `questions` (id, bank_id, type [mcq, multi, fib, dnd, pbq, ...], stem, payload jsonb [type-specific], answer_key jsonb, explanation, difficulty, domain_id, weight, is_pretest, version)
- `question_domains` (id, master_item_id, name, weight_pct) for blueprint objectives
- `quizzes` (id, sub_item_id, mode [practice, timed, exam_sim], config jsonb [sections, timing, navigation rules, question pool rules])
- `scoring_profiles` (id, owner_id, name, version, definition jsonb, checksum, is_official). **Immutable per version.**
- `attempts` (id, user_id, quiz_id, profile_snapshot jsonb, seed, started_at, deadline_at, submitted_at, status, raw_score, scaled_score, pass boolean, breakdown jsonb)
- `attempt_items` (attempt_id, question_id, ord, presented_payload jsonb [with shuffled options], response jsonb, flagged, time_ms, points_awarded, grading_detail jsonb)
- `goals` (user_id, master_item_id, target_score, target_date, created_at)
- `analytics_daily` (user_id, master_item_id, domain_id, date, attempts, accuracy, avg_time_ms, minutes_studied), maintained by worker
- `srs_state` (user_id, card_id, fsrs state fields, due_at) for spaced repetition

**Question payload shapes (examples):**
- `mcq`: options[], correct[1]
- `multi`: options[], correct[n], select rule ("select exactly 2")
- `fib`: blanks[] with accepted answers, normalization rules (case, whitespace, numeric tolerance, regex)
- `dnd`: items[], targets[], mapping, ordering allowed
- `pbq`: declarative scenario graph (terminal emulator, config form, matching, hotspot) with a checklist of **verifiable end-state assertions**, each worth points

### 3.4 `ai` schema and the secret vault

- `ai_credentials` (id, **user_id NOT NULL**, provider, kind [api_key, oauth_refresh], label, ciphertext bytea, nonce bytea, dek_id, key_version, last4, created_at, last_used_at, revoked_at)
- `user_deks` (id, user_id, wrapped_dek bytea, kek_version, created_at, rotated_at)
- `ai_preferences` (user_id, default_provider, default_model, per-task overrides)
- `ai_jobs` (id, user_id, kind, input_ref, status, result_ref, error, tokens_in, tokens_out, created_at). **Job records contain no secrets.**
- `ai_usage` (user_id, provider, model, day, tokens, requests)
- `agent_threads` / `agent_messages` (user_id, context_ref [page, question, attempt], messages jsonb). Private to the user.

**Encryption strategy (AES-256-GCM, envelope):**

1. **KEK:** A 256-bit master key supplied via Docker secret or file (`ULTIMYR_VAULT_KEK_FILE`). Optional adapters for AWS KMS, GCP KMS, or Vault Transit for managed environments. Only the **ai-gateway** container mounts it. Versioned for rotation.
2. **DEK per user:** Random 256-bit key generated on first credential, stored wrapped (AES-256-GCM under KEK) in `user_deks`.
3. **Secret encryption:** AES-256-GCM with a fresh random 96-bit nonce per write. **AAD = `user_id | credential_id | provider | key_version`**, so a ciphertext copied to another user's row fails authentication.
4. **Decrypt-on-use only:** Plaintext exists only in ai-gateway memory for the duration of a provider call, never logged, never returned. The API is **write-only** (the UI shows provider, label, and last 4 characters).
5. **Identity from the token, never the request:** The gateway resolves credentials by `sub` from a verified JWT. There is no parameter anywhere that accepts another user's ID. Admins have **no endpoint** to list, read, or use another user's credentials. An admin adding an integration creates it on their own `user_id`.
6. **DB role separation:** The `ai` schema role is distinct. Other services cannot read these tables. Backups contain only ciphertext.
7. **Rotation and offboarding:** KEK rotation re-wraps DEKs lazily (batch job). User deletion or SCIM deprovisioning destroys the DEK (**crypto-shredding**), making ciphertext unrecoverable.
8. **SSRF and exfil controls:** Provider base URLs come from an allowlist (custom endpoints require explicit admin enablement, and are still per-user). Outbound calls pass an egress allowlist.
9. **Tests required before release:** Cross-user access attempts, tampered AAD, nonce uniqueness, log scrubbing, and a "KEK absent" boot test that proves the gateway refuses to start vault features rather than falling back to plaintext.

**Verdict on the brief's gate:** This design is a standard, auditable pattern with clear isolation (separate service, role, key, and AAD binding). **I recommend keeping on-platform AI.** If the KEK cannot be provisioned in a given deployment, the gateway disables vault features and the platform runs MCP-only, so the fallback you specified is built in.

---

## 4. API and MCP Routing

### 4.1 Edge routing (Traefik)

| Path prefix | Target |
|---|---|
| `/` | web |
| `/api/auth/*`, `/.well-known/*`, `/oauth/*` | auth |
| `/scim/v2/*` | auth (SCIM, bearer token) |
| `/api/content/*` | content |
| `/api/quiz/*` | quiz |
| `/api/ai/*` | ai-gateway |
| `/mcp` | mcp (Streamable HTTP) |
| `/api/docs` | Aggregated OpenAPI + Scalar/Swagger UI |

Everything is versioned (`/api/v1/...` in the public contract).

### 4.2 Auth service

```
POST   /v1/auth/register            (can be disabled by admin)
POST   /v1/auth/login               password step
POST   /v1/auth/mfa/totp/verify
POST   /v1/auth/passkeys/options    | /verify   (register + authenticate)
GET    /v1/auth/sso/:provider/start | /callback  (OIDC, OAuth2)
POST   /v1/auth/saml/:provider/acs  | GET /metadata
POST   /v1/auth/refresh | /logout
GET    /v1/me                       PATCH /v1/me
GET/POST/DELETE /v1/me/api-keys
GET/DELETE      /v1/me/mcp-connections
GET/POST/DELETE /v1/me/passkeys, /v1/me/totp, /v1/me/sessions
GET    /v1/admin/users, groups, roles, idp-providers   (admin)
GET    /.well-known/jwks.json
GET    /.well-known/oauth-authorization-server
POST   /oauth/register | /oauth/authorize | /oauth/token   (MCP clients)
SCIM:  /scim/v2/Users, /Groups, /ServiceProviderConfig, /Schemas, /ResourceTypes
       (GET, POST, PUT, PATCH, DELETE, filter, pagination, bulk optional)
```

### 4.3 Content service

```
GET/POST        /v1/archives                 (master items)
GET/PATCH/DELETE /v1/archives/:id
POST            /v1/archives/:id/icon        (PNG upload)
GET/POST        /v1/archives/:id/folios      (sub-items)
GET/PATCH/DELETE /v1/folios/:id
GET             /v1/folios/:id/versions | POST /restore
GET/POST/PATCH  /v1/decks/:id/cards
GET/POST/DELETE /v1/{archives|folios}/:id/grants
GET             /v1/search?q=
POST            /v1/import | /v1/export      (Markdown, JSON, Anki CSV)
```

### 4.4 Quiz service

```
GET/POST/PATCH  /v1/banks/:id/questions
GET/POST        /v1/scoring-profiles         POST /v1/scoring-profiles/:id/simulate
POST            /v1/quizzes/:id/attempts     (starts, returns deadline + server clock)
GET             /v1/attempts/:id             (resume)
PUT             /v1/attempts/:id/items/:qid  (save response, flag)
POST            /v1/attempts/:id/submit
GET             /v1/attempts/:id/review      (breakdown, explanations)
GET             /v1/me/analytics?archive=&range=
GET/PUT         /v1/me/goals
GET             /v1/me/study-queue           (SRS due cards + weak domains)
SSE             /v1/attempts/:id/events      (timer sync)
```

### 4.5 AI Gateway

```
GET/PUT/DELETE  /v1/ai/credentials           (own only; write-only secrets)
POST            /v1/ai/credentials/:id/test
GET/PUT         /v1/ai/preferences
POST            /v1/ai/generate              (async; guide|deck|quiz from topic/source)
GET             /v1/ai/jobs/:id
POST            /v1/ai/agent/threads | /threads/:id/messages   (SSE stream)
```

### 4.6 MCP server (`/mcp`)

- **Transport:** Streamable HTTP. **Auth:** OAuth 2.1 with PKCE and dynamic client registration against the auth service (protected resource metadata published per the MCP authorization spec), **or** `Authorization: Bearer <api-key>` for headless clients. A "connection string" in the UI is the MCP URL plus a one-time key.
- **Identity:** Every call executes as the authenticated user with the token's scopes. No service account shortcuts.

**Tools**

| Tool | Scope | Purpose |
|---|---|---|
| `list_archives`, `get_archive` | content:read | Browse master items |
| `search_materials` | content:read | Search across accessible items |
| `get_guide`, `get_deck`, `get_quiz` | content:read | Read material |
| `create_guide`, `update_guide` | content:write | Ingest and edit guides (creates version, marked `source=mcp`, lands as **draft** by default) |
| `create_deck`, `upsert_cards`, `delete_cards` | content:write | Flashcard edits |
| `create_quiz_questions` | quiz:write | Add questions in the typed schema, validated server-side |
| `get_progress`, `get_weak_areas` | quiz:read | Let an external AI coach the user |
| `share_item` | content:share | Grant access (off by default scope) |

**Resources:** `ultimyr://archive/{id}`, `ultimyr://folio/{id}`, `ultimyr://deck/{id}`. **Prompts:** `make_study_guide`, `quiz_me_on`, `explain_my_mistakes`.

**Safety:** Write tools are rate limited and size capped, schema-validated, and logged with the connection ID. Optional "require approval" mode holds MCP writes as drafts for the user to publish.

---

## 5. Supplemental Features and Lore

### 5.1 High-value features (ranked)

1. **Spaced repetition (FSRS)** for flashcards, with a daily "Vigil" queue. Biggest learning impact per effort.
2. **Readiness score:** Predicts pass probability from domain accuracy, recency, and question difficulty, shown against the user's goal and exam date.
3. **Weak domain remediation:** One click builds a targeted quiz and links guide sections for the domains the user misses.
4. **Draft-then-publish for AI content** with source citations and a confidence flag. Prevents silently wrong study material.
5. **Source-grounded generation:** Upload PDF/URL/notes, generate only from that material, with per-item citations back to the passage.
6. **Exam simulator realism:** Server-authoritative timer, section locks, flag and review screen, optional break, pretest items that do not count, results screen that mimics the vendor.
7. **Answer explanation agent** on any review page (in scope, contextual).
8. **Import and export:** Anki, CSV, Markdown, and full archive export (no lock-in).
9. **Study streaks and goals** (gamification kept quiet): streak, minutes, mastery stars per domain, no leaderboards by default.
10. **Org features:** Cohorts, assigned quizzes with due dates, instructor dashboards (builds on groups and grants).
11. **Accessibility:** WCAG 2.2 AA, keyboard-first navigation, reduced motion, dyslexia-friendly font option, extra-time accommodations for timed exams.
12. **PWA/offline for decks**, and a **focus mode** that hides everything except the card or question.
13. **Public share links** (read-only, revocable) and a community **Archive Exchange** (later, needs moderation).
14. **Webhooks and audit log viewer** for admins.

### 5.2 Lore and naming system

Keep the UI plain and calm. The lore lives in **words**, not decoration.

| Concept | Ultimyr name |
|---|---|
| Master item (cert/course) | **Archive** |
| Study guide | **Codex** |
| Flashcard deck | **Folio** (single card: **leaf**) |
| Quiz / exam | **Trial** (full exam sim: **Rite**) |
| Daily SRS queue | **Vigil** |
| Streak | **Candle** (unbroken days keep it lit) |
| AI agent | **The Archivist** |
| Dashboard | **The Reading Room** |
| Sharing | **Lend** / **Lent to** |
| API keys / MCP | **Keys** / **Conduits** |
| Admin area | **The Stacks** |

Note: Folios in the API section above map to "sub-items". The API keeps neutral names (`/archives`, `/items`) so lore never leaks into integrations. I will finalize route names in Phase 0.

**Micro-copy examples (tone: quiet, dry, a little wry, never cute):**
- Splash: "Ultimyr. A quiet place to know things." CTA: "Enter the Archives"
- Empty Archives: "Nothing shelved yet. Begin with a single page."
- Loading: "Fetching from the stacks..." (a small Lucide `book-open` page-turn)
- Success: "Committed to memory." (Lucide `check` draws itself)
- Failed attempt: "A gap, found. Better now than on exam day."
- Streak: "Candle lit for 12 days."
- AI thinking: "The Archivist is consulting the shelves."
- 404: "This shelf is empty. The Archive has no record of this page."
- Delete confirm: "Strike this from the Archives? You can recover it for 30 days."
- Vault copy: "Your keys are sealed to you alone. Not even the Stacks can read them."

### 5.3 Design system rules

- **Palette:** Warm off-white and ink (dark mode: deep ink and parchment text), one restrained accent (muted gold or verdigris). No gradients except a subtle splash.
- **Type:** Serif for headings and guide reading (for example Newsreader or Source Serif), a clean sans for UI (Inter). Generous line height, 65 character measure.
- **Layout:** One column of content, one optional side rail, no dashboard clutter. Navigation: Archives, Vigil, Trials, Reading Room.
- **Motion:** 150 to 250 ms, ease-out, honors reduced motion.
- **Icons:** `lucide-react` wrapped by `<UIcon>` with utilities: `composeIcons` (stack/badge two icons), `animated` presets (spin, pulse, draw-on, bounce), `statusIcon` (loading, success, error) so every state uses a consistent animated icon. Custom master item icons: uploaded transparent PNG, else Lucide fallback chosen from a picker.
- **Charts:** Line for score history with goal line, bar for domain accuracy, calendar heat strip for study days. Small, labeled directly, colorblind safe, with accessible table fallback.

---

## 6. Exam Scoring Engine (design detail)

This is the "mathematically precise" core, so it gets its own section.

- **Pure function:** `grade(profile, questions, responses) -> result`. No I/O, no clocks, no randomness. Same library runs on server (authoritative) and client (preview).
- **Exact arithmetic:** Points stored as integers (basis points) or `decimal.js`. No floating point in totals. Rounding rules are explicit profile settings (half-up, floor, banker's).
- **Declarative scoring profile** (JSON, schema validated, versioned, checksummed):
  - Per type rules: all-or-nothing, partial credit (proportional, penalty per wrong choice, floor at zero), per-blank scoring, PBQ per-assertion weights.
  - Weighting by domain or question weight, and exclusion of unscored pretest items.
  - Negative marking options.
  - **Scaled score mapping:** piecewise-linear table or formula (for example raw 0..N to 100..900 with pass at 700) plus per-form equating tables where a vendor publishes them.
  - Pass rule: scaled threshold, raw percent, or "must pass every domain".
  - Section rules: per-section minimums, time limits.
- **Official vs custom:** Official profiles are curated and marked with source and "last verified" date. Users can fork a profile, run `simulate` against sample responses, and see a traceable breakdown.
- **Honesty about fidelity:** Many vendors do not publish exact algorithms. The UI labels profiles as **Published formula**, **Community estimate**, or **Custom**. We never claim exact vendor equivalence without a source.
- **Verification:** Golden test vectors per profile (inputs and expected outputs), property tests (monotonicity, bounds), and every attempt stores its profile snapshot so old results never change when a profile is updated.
- **Question-type plugins:** Each type implements `validate`, `render schema`, `normalize response`, `grade`. New types are added without touching the core.
- **Timing integrity:** Server owns `deadline_at`. Client timer is cosmetic. Late submissions are graded up to the deadline, with a grace window setting.

---

## 7. Deployment and Docker

### 7.1 Compose layout (to be delivered in Phase 1)

- Services: `traefik`, `web`, `auth`, `content`, `quiz`, `ai-gateway`, `mcp`, `worker`, optional `redis`, bundled `postgres` under a Compose **profile** (`bundled-db`).
- **External Postgres:** Set `DATABASE_URL` (or `PG_HOST/PORT/USER/PASSWORD/DB`, `PG_SSLMODE`). With the `bundled-db` profile off, nothing starts a local DB. A one-shot `migrate` job runs per-service migrations and creates schemas and roles, with a documented SQL script for DBAs who do not grant superuser rights.
- **Secrets:** Docker secrets or `_FILE` env variables for DB password, JWT signing key, API key pepper, and the vault KEK (mounted **only** into ai-gateway).
- **Profiles:** `full` (web + all), `headless` (no web, API and MCP only), `observability`.
- **Health:** `/healthz` and `/readyz` on each service with compose `depends_on: condition: service_healthy`.
- **Images:** Multi-stage, distroless or slim Node, non-root, read-only filesystem, pinned digests, SBOM and image scanning in CI.
- **Config:** One `.env.example`, validated at boot by Zod (fail fast, with human-readable errors).
- **Scaling:** Stateless services scale horizontally (`--scale quiz=3`). Exam timers are DB-based so any replica can serve an attempt. Kubernetes manifests or Helm chart can come later without changes to the services.

### 7.2 Security baseline

- Argon2id passwords, breach-password check (k-anonymity), login throttling, WebAuthn user verification, TOTP replay protection.
- Strict CSP, CSRF protection, SameSite cookies, secure headers, input validation at every boundary, SSRF guard on any URL fetch (import and AI).
- SCIM bearer tokens hashed, scoped to the SCIM endpoint only.
- Tamper-evident audit log for auth, sharing, key creation, and admin actions.
- Dependency and secret scanning in CI, with a threat model document kept in the repo.

---

## 8. Phased Implementation Roadmap

Each phase ends with a **demoable, tested slice** and an exit checklist. Services stay deployable at every phase boundary.

| Phase | Name | Scope | Exit criteria |
|---|---|---|---|
| **0** | Foundations | Monorepo, shared packages (`contracts`, `authz`, `scoring` stub, `ui-icons`), CI, lint, Zod config, OpenTelemetry skeleton, ADRs, final naming | CI green, `docker compose up` shows empty health checks |
| **1** | Platform skeleton and Auth core | Compose (bundled + external Postgres, headless profile), Traefik, migrations runner, **auth**: local login, sessions, JWT/JWKS, roles, admin bootstrap, **web** shell with design tokens and splash page | Register, login, logout works; external Postgres verified; splash approved |
| **2** | Identity hardening | TOTP, passkeys, OIDC/OAuth, SAML, groups, API keys, **SCIM 2.0** (conformance tested against Okta/Entra/Keycloak test setups), audit log | SCIM conformance suite passes; passkey + TOTP flows tested in browsers |
| **3** | Content core | Master items (icons, quick stats), guides, decks, versioning, sharing grants with ReBAC and group grants, search, Markdown import/export, library UI | Share a guide to an IdP group and verify read/write/edit matrix in tests |
| **4** | Quiz engine and scoring | Question types with plugins, banks, practice mode, **scoring profiles + golden vectors**, attempts, review screen | All types gradable; scoring library 100% covered; first official profile reproduced from published sample |
| **5** | Exam simulator and analytics | Timed and section modes, server timer, flag/review, PBQ runtime, analytics rollups, goals, charts, readiness score, SRS "Vigil" | A full mock exam end to end; analytics match hand-calculated fixtures |
| **6** | AI Gateway and vault | Vault, adapters (Gemini first per section 1.4, then OpenAI, Anthropic, others), generation jobs, draft-then-publish, in-app Archivist agent | Isolation test suite passes (cross-user, admin, tamper, log scrub); KEK-absent boot safe |
| **7** | MCP server | OAuth for MCP, tools, resources, prompts, scope enforcement, rate limits, connection management UI | Verified with at least two real MCP clients; write tools produce drafts and versions |
| **8** | Polish and lore | Full micro-copy pass, animations, empty states, accessibility audit, performance budgets, PWA, theme finishing | WCAG AA audit clean, Lighthouse targets met |
| **9** | Hardening and release | Load tests, pen-test checklist, backup and restore docs, upgrade path, Helm/K8s optional, docs site, public API reference | Release candidate, runbooks, `v1.0` |

**Sequencing notes**
- Phases 3 and 4 can overlap after contracts are fixed, if parallel contributors exist.
- AI is deliberately after the core. The platform is fully useful without it, and MCP (Phase 7) gives AI access early to anyone who wants it.
- Every phase includes: migrations, OpenAPI updates, tests, docs, and a short ADR for any decision that changed.

---

## 9. Risks and Open Questions

| Risk or question | Mitigation or ask |
|---|---|
| "Non-token Gemini" meaning and Google OAuth scope limits | Confirm intent (section 1.4). Fallback: API-key Gemini |
| Vendor scoring algorithms are often unpublished | Label fidelity honestly, support custom profiles, curate sources |
| Auth scope is large (SAML + SCIM + passkeys) | Library-based, spike gate, Keycloak/Zitadel as fallback |
| PBQ simulations are open-ended | Start with 3 declarative PBQ templates (matching, form config, terminal-style checks), expand by plugin |
| AI hallucinated study content | Draft-then-publish, citations, source-grounded mode |
| Microservice overhead for a small team | Shared packages, one Docker build pipeline, Postgres-only infra, services kept small |
| Licensing and trademark of certification content | Users supply their own content, no bundled vendor material |

**Questions for you**
1. Is the Gemini assumption in section 1.4 right?
2. Is the lore naming in section 5.2 acceptable (Archive, Codex, Folio, Trial, Vigil, Archivist)?
3. Single-tenant per install (my default) or multi-org tenancy from the start?
4. Any first target certification whose scoring profile we should model as the reference (for example a CompTIA, AWS, or Cisco exam)?

**Next action:** Approve this plan (or mark changes), and I proceed to **Phase 0 and 1** (monorepo, compose with external Postgres support, Auth core, splash page).
