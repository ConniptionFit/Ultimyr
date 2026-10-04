-- Auth service: Phase 1 core (local accounts, roles, sessions, audit).
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  display_name  text NOT NULL,
  password_hash text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deprovisioned')),
  created_via   text NOT NULL DEFAULT 'local' CHECK (created_via IN ('local', 'sso', 'scim')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_key ON auth.users (lower(email));

CREATE TABLE auth.role_assignments (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role    text NOT NULL CHECK (role IN ('platform_admin', 'org_admin', 'author', 'learner')),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE auth.sessions (
  id                 uuid PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  refresh_hash       text NOT NULL,
  prev_refresh_hash  text,
  user_agent         text,
  ip                 text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz
);
CREATE INDEX sessions_user_idx ON auth.sessions (user_id);

CREATE TABLE auth.audit_log (
  id        bigserial PRIMARY KEY,
  ts        timestamptz NOT NULL DEFAULT now(),
  actor_id  uuid,
  action    text NOT NULL,
  target    text,
  ip        text,
  metadata  jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_log_ts_idx ON auth.audit_log (ts);
