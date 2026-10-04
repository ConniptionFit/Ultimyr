# MCP server

Ultimyr speaks the [Model Context Protocol](https://modelcontextprotocol.io), so Claude and other MCP apps can read your material, coach you from your progress, and add drafts. The address is:

```
https://<your Ultimyr address>/mcp
```

(That is `ULTIMYR_PUBLIC_URL` plus `/mcp`. Settings shows it with a copy button.)

## Connect Claude
1. In Claude, open Settings, then Connectors, then add a custom connector.
2. Paste the address. Claude finds the sign-in details itself.
3. Ultimyr opens a consent page. Sign in, choose what to allow, and press **Connect**.

Disconnect any time in Settings, Connected apps. The app then cannot refresh; a token it already holds expires within 30 minutes.

**Without OAuth:** create an API key in Settings, Security (pick scopes) and send `Authorization: Bearer ulk_...` to `/mcp`. Keys are exchanged for a short token by the server and a revoked key stops working within two minutes.

## What it can do
Everything runs **as you**, with only the scopes you approved. The MCP server holds no data and no credentials of its own: it passes your token to the content and quiz services, which enforce access exactly as they do for the web app. A tool whose scope you did not grant is not even listed.

| Tool | Scope | Purpose |
|---|---|---|
| `list_archives`, `get_archive` | `content:read` | Browse archives and what is in them |
| `search_materials` | `content:read` | Full text search of archives, guide sections and cards |
| `get_guide`, `get_deck` | `content:read` | Read material |
| `get_quiz` | `quiz:read` | Quiz and questions (questions only for editors) |
| `create_guide`, `update_guide` | `content:write` | Write guides. New versions are marked `mcp` |
| `create_deck`, `upsert_cards`, `delete_cards` | `content:write` | Flashcards |
| `create_quiz`, `create_quiz_questions` | `content:write`, `quiz:write` | Quizzes. Questions are validated strictly, all or nothing |
| `get_progress`, `get_weak_areas` | `quiz:read` | Let an AI coach you from your results |
| `share_item` | `content:share` | Give a person or group access. Off unless you grant sharing |

**Resources:** `ultimyr://archive/{id}`, `ultimyr://guide/{id}` (Markdown), `ultimyr://deck/{id}`. **Prompts:** `make_study_guide`, `quiz_me_on`, `explain_my_mistakes`. Tools, resources and prompts use plain names even when themed names are on.

## Safety
- **Drafts.** New material and quiz questions are saved as drafts with source `mcp`, visible only to editors until a person publishes them. Editing **published** material creates a new version (so it can be restored) and moves the item back to draft until republished. Pass `holdForReview: false` on a tool call to skip that hold.
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
| `GET /oauth/authorize` | `response_type=code`, `client_id`, exact `redirect_uri`, `code_challenge` (S256), optional `scope` (default: content and quiz read and write) and `state`. Unknown clients and redirects are refused, never redirected to. Continues on the consent page. |
| `POST /oauth/token` | `authorization_code` (with `code_verifier`) or `refresh_token`. Codes live 5 minutes and work once. Refresh tokens rotate on every use and expire after 90 days of disuse; replaying an old one revokes the connection. Access tokens last 30 minutes. |

Tokens are the same EdDSA JWTs as everywhere else (`sid` is `mcp:<connection id>`, `amr` is `oauth`). Connected apps cannot manage the account: sessions, keys, passkeys, other connections and consent require a real sign in.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Claude cannot add the connector | The address must be reachable over HTTPS from the internet (Claude connects from its own servers). Check `ULTIMYR_PUBLIC_URL` matches the address you use, and that the proxy forwards `/mcp`, `/oauth/*` and `/.well-known/*`. |
| Consent page says the request is not valid | The client's redirect address was not registered. Remove the connector and add it again. |
| Tools missing | You did not grant that scope. Disconnect and reconnect, and tick it. |
| `Ultimyr refused that: too many cards` and similar | The message is the real reason from the service. Reduce the request. |
