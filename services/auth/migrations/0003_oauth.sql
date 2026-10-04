-- Phase 7: OAuth 2.1 for MCP clients (dynamic client registration, authorization code + PKCE, rotating refresh tokens).

CREATE TABLE auth.oauth_clients (
  client_id      text PRIMARY KEY,
  client_name    text NOT NULL,
  redirect_uris  text[] NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- One row per authorized app per person. The refresh token is stored only as a keyed hash and rotates on every use.
CREATE TABLE auth.mcp_connections (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  client_id     text NOT NULL REFERENCES auth.oauth_clients (client_id) ON DELETE CASCADE,
  client_name   text NOT NULL,
  scopes        text[] NOT NULL,
  refresh_hash  text NOT NULL,
  created_via   text NOT NULL DEFAULT 'oauth',
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX mcp_connections_user_idx ON auth.mcp_connections (user_id) WHERE revoked_at IS NULL;

-- Authorization codes are single use and short lived. Only a hash is stored.
CREATE TABLE auth.oauth_codes (
  code_hash       text PRIMARY KEY,
  client_id       text NOT NULL REFERENCES auth.oauth_clients (client_id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  scopes          text[] NOT NULL,
  redirect_uri    text NOT NULL,
  code_challenge  text NOT NULL,
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz
);
