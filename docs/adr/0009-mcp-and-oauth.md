# ADR 0009: MCP server and OAuth for connected apps

**Status:** Accepted (Phase 7)

## Decisions
- **A separate, stateless `mcp` service.** It is a protocol adapter with its own rate limits and no database. Each tool call forwards the caller's own token to the content and quiz services, so access rules have one source of truth and MCP has no privilege of its own.
- **Stateless Streamable HTTP with JSON responses.** No session ids to leak or expire, nothing to clean up, and it works behind any proxy. Server push is not needed because no tool is long running.
- **OAuth 2.1 lives in the auth service**, next to users and sessions, with dynamic client registration (needed because MCP clients cannot be pre-registered), PKCE S256 only, public clients only, single use short lived codes, and rotating refresh tokens with reuse detection. The consent page is part of the web app and is not frameable.
- **API keys remain a second way in** for headless tools. The service exchanges them at auth and caches the result for at most two minutes.
- **Scopes are the permission model.** Tools are only listed when the connection holds their scope, and the downstream services enforce it again. Sharing is an explicit, off by default scope.
- **Writes land as drafts**, marked `mcp`. Editing published material also holds it back as a draft by default, because a version history alone would let an external model change what learners see instantly.
- **Access tokens are not audience bound to `/mcp`.** One token shape is used across services. Short lifetimes (30 minutes) and revocation of the refresh token limit exposure. Per resource audiences are a candidate for Phase 9.

## Consequences
Revoking a connection takes effect on the auth service at once but other services honor an issued token until it expires (up to 30 minutes). Dynamic registration is open to anyone who can reach the server, so it is rate limited and capped (2000 clients); registering a client grants nothing until a signed in person approves it.
