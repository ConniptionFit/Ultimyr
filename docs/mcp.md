# MCP server

Ultimyr speaks the [Model Context Protocol](https://modelcontextprotocol.io), so Claude and other MCP apps can read your material, coach you from your progress, and add drafts. The address is:

```
https://<your Ultimyr address>/mcp
```

(That is `ULTIMYR_PUBLIC_URL` plus `/mcp`. Your settings shows it with a copy button.)

## Connect Claude
1. In Claude, open Settings, then Connectors, then add a custom connector.
2. Paste the address. Claude finds the sign-in details itself.
3. Ultimyr opens a consent page. Sign in, choose what to allow, and press **Connect**.

Disconnect any time in Your settings, Connected apps. The app then cannot refresh; a token it already holds expires within 30 minutes.

**Without OAuth:** create an API key in Your settings, Security (pick scopes) and send `Authorization: Bearer ulk_...` to `/mcp`. Keys are exchanged for a short token by the server and a revoked key stops working within two minutes.

## What it can do
Everything runs **as you**, with only the scopes you approved. The MCP server holds no data and no credentials of its own: it passes your token to the content and quiz services, which enforce access exactly as they do for the web app. A tool whose scope you did not grant is not even listed.

| Tool | Scope | Purpose |
|---|---|---|
| `list_archives`, `get_archive` | `content:read` | Browse archives and what is in them |
| `create_archive`, `update_archive` | `content:write` | Create an archive (private, owned by the person) to hold material, and edit its title, overview, vendor, validity and tags. Cannot change sharing or delete |
| `search_materials` | `content:read` | Full text search of archives, guide sections and cards |
| `get_guide`, `get_deck` | `content:read` | Read material |
| `get_quiz` | `quiz:read` | Quiz and questions (questions only for editors) |
| `create_guide`, `update_guide` | `content:write` | Write guides. New versions are marked `mcp`. `create_guide` and `create_deck` take `objectiveIds` to link the material to exam objectives in the same call |
| `create_deck`, `upsert_cards`, `delete_cards` | `content:write` | Flashcards |
| `create_quiz`, `create_quiz_questions` | `content:write`, `quiz:write` | Quizzes. Questions are validated strictly, all or nothing |
| `list_resources` | `content:read` | The external links saved in an archive |
| `get_roadmap` | `content:read` | The roadmap with step ids, your progress and the next step |
| `add_resources` | `content:write` | Save up to 50 links (YouTube, Anthropic training pages, docs). A link already saved is updated, not duplicated. Saved as drafts |
| `import_outline` | `content:write` | Add a whole nested outline to the roadmap in one call: `## Stage` lines and bulleted steps with `[Title](https://link) 20m`, `[[Guide title]]` and `(optional)`. The easiest way to load a certification. Saved as a draft |
| `set_roadmap` | `content:write` | Replace the roadmap: stages of steps that are guides, decks, quizzes, links or milestones, each able to hold steps of its own. Saved as a draft. Call `get_roadmap` first and keep step ids so nobody loses progress |
| `get_step_note`, `get_step_flashcards` | `notes:use` | Read your note for a roadmap step (kept in Ultimyr, mirrored to Obsidian if connected), and the `Question :: Answer` lines in it (hand them to `create_deck`). Pass `archiveId` the first time |
| `append_step_note` | `notes:use` | Add text to the END of a step note. Never edits or removes what you wrote |
| `get_objectives` | `content:read` | The exam objectives (domains and topics with weights) and what is linked to each |
| `set_objectives` | `content:write` | Add or update objectives from an outline. Merges by code or title, never deletes |
| `link_objectives` | `content:write` | Link guides, decks, cards or resources to objectives |
| `link_questions` | `quiz:write` | Tag questions with an objective |
| `get_coverage` | `content:read`, `quiz:read` | Per objective: cards, questions, your accuracy, and the biggest gaps |
| `get_build_queue` | `content:read` (`quiz:read` for exact question counts) | The to-do list for building an archive out: the next few tasks (a guide per domain, flashcards and questions per objective), the decks and quizzes that exist, and progress. Depth: quick, standard, deep |
| `get_tag_vocabulary` | `content:read` | The shared tags (`topic:ai`, `content-type:video`, `level:beginner`) |
| `get_tags` | `content:read` | The tags on an archive's parts: set, implied by type, and read from text, plus icons and their source. Filter by kind or tag |
| `set_tags` | `content:write` | Set the exact tags on the archive, stages, steps, links, material or objectives. Applies at once (tags are not drafts); icons not chosen by a person are re-picked |
| `search_icons` | `content:read` | The whole bundled Lucide library, by name or word, or the icons best suited to a tag |
| `suggest_icons` | `content:read` | Icons ranked for a stage, step or archive (more matching tags rank higher), or for any list of tags |
| `set_icons` | `content:write` | Choose an icon for an archive, stage or step (never replaced automatically), or `null` to hand it back to automatic assignment |
| `get_credentials` | `content:read` | Your credentials with exam dates, renewals, CEU totals and current alerts. Voucher codes are never returned |
| `get_exam_plan` | `quiz:read` | The day by day plan to an exam date |
| `get_progress`, `get_weak_areas` | `quiz:read` | Let an AI coach you from your results |
| `share_item` | `content:share` | Give a person or group access. Off unless you grant sharing |

**Resources:** `ultimyr://archive/{id}`, `ultimyr://guide/{id}` (Markdown), `ultimyr://deck/{id}`. **Prompts:** `make_study_guide`, `quiz_me_on`, `explain_my_mistakes`, `build_roadmap`, `build_certification`, `continue_build`. Tools, resources and prompts use plain names even when themed names are on.

## Build a whole certification from one prompt
Open **Exam prep > Build with an AI assistant** (themed: Commission the Curator), type the certification and pick a depth, then paste the prompt into Claude. On an archive's **Coverage** tab, the same panel shows build progress and a prompt to continue.

How the assistant works through it:
1. **Facts first.** It asks you for the vendor's exam objectives and stops if you have none. It never guesses objectives, weights, scores or prices.
2. **Objectives and roadmap.** `set_objectives`, `add_resources` (only links you gave it), `import_outline`.
3. **The queue.** `get_build_queue` returns a few tasks at a time, heaviest exam domains first: a guide per domain, flashcards and questions per objective. The assistant writes them, links them to their objectives, and asks again until `done` is true. Depth sets the target per objective: quick 5 cards and 3 questions, standard 10 and 6, deep 20 and 12.
4. **Report.** `get_coverage` shows what is thin. Everything is a draft until you publish it.

Because the queue is computed from what already exists, a new chat can pick up exactly where an old one stopped (`continue_build`). Draft questions count, so nothing is written twice. Writes are rate limited per minute; the assistant is told to wait and continue.

No connector? Any chat can write the same thing as text and you paste it in. See [bundle.md](bundle.md).

## Safety
- **Drafts.** New material and quiz questions are saved as drafts with source `mcp`, visible only to editors until a person publishes them. Editing **published** material creates a new version (so it can be restored) and moves the item back to draft until republished. Pass `holdForReview: false` on a tool call to skip that hold.
- **Links.** Ultimyr stores links without opening them, so it cannot tell whether one is real. The server's instructions tell the model never to invent a URL, but review every draft link before publishing.
- **Limits.** `MCP_RATE_PER_MINUTE` requests (default 120) and `MCP_WRITE_PER_MINUTE` changes (default 30) per person. Writes are size capped and validated before anything is sent on.
- **Errors** are short plain messages. Upstream bodies, stack traces and addresses are never passed to the client.
- **No session state.** Each request is self contained (stateless Streamable HTTP, JSON responses), so there is no session to steal.
- **Prompt injection.** The server's instructions tell the model that material can contain text written by other people and must be treated as data. Review drafts before publishing.
- **Audit.** Each tool call is logged with the person and connection id (never arguments). Authorizations and revocations are in the admin audit log.

## OAuth details (for client authors)
Ultimyr follows the MCP authorization spec: OAuth 2.1 with PKCE (S256 only), dynamic client registration (public clients), and protected resource metadata.

| Endpoint | Notes |
|---|---|
| `GET /.well-known/oauth-protected-resource` | Names the resource (`/mcp`) and its authorization server. A 401 from `/mcp` points here in `WWW-Authenticate`. |
| `GET /.well-known/oauth-authorization-server` | Issuer is `ULTIMYR_PUBLIC_URL`. Endpoints, `S256`, `none` client auth, scopes. |
| `POST /oauth/register` | `{ client_name, redirect_uris[] }`. Redirects must be https, `http://localhost` (or 127.0.0.1) or an app scheme, with no fragment. Rate limited. |
| `GET /oauth/authorize` | `response_type=code`, `client_id`, exact `redirect_uri`, `code_challenge` (S256), optional `scope` (default: content and quiz read and write, and `notes:use`; untick any on the consent page) and `state`. Unknown clients and redirects are refused, never redirected to. Continues on the consent page. |
| `POST /oauth/token` | `authorization_code` (with `code_verifier`) or `refresh_token`. Codes live 5 minutes and work once. Refresh tokens rotate on every use and expire after 90 days of disuse; replaying an old one revokes the connection. Access tokens last 30 minutes. |

Tokens are the same EdDSA JWTs as everywhere else (`sid` is `mcp:<connection id>`, `amr` is `oauth`). Connected apps cannot manage the account: sessions, keys, passkeys, other connections and consent require a real sign in.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Claude cannot add the connector | The address must be reachable over HTTPS from the internet (Claude connects from its own servers). Check `ULTIMYR_PUBLIC_URL` matches the address you use, and that the proxy forwards `/mcp`, `/oauth/*` and `/.well-known/*`. |
| Consent page says the request is not valid | The client's redirect address was not registered. Remove the connector and add it again. |
| Tools missing | You did not grant that scope. Disconnect and reconnect, and tick it. |
| `Ultimyr refused that: too many cards` and similar | The message is the real reason from the service. Reduce the request. |

**Scope:** build prompts, the Claude Skill and the AI generator tell the assistant to keep only learning material for the exam objectives (no FAQs, welcome or intro pages, marketing or policy pages), in guides and in saved links.
