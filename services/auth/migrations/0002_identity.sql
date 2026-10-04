-- Phase 2: MFA, passkeys, API keys, groups, SSO providers, SCIM.

ALTER TABLE auth.users
  ADD COLUMN external_id text,
  ADD COLUMN scim_managed boolean NOT NULL DEFAULT false,
  ADD COLUMN given_name text,
  ADD COLUMN family_name text;
CREATE UNIQUE INDEX users_external_id_key ON auth.users (external_id) WHERE external_id IS NOT NULL;

-- amr = authentication methods used for the session (pwd, otp, recovery, webauthn, sso)
ALTER TABLE auth.sessions ADD COLUMN amr text[] NOT NULL DEFAULT '{pwd}';

CREATE TABLE auth.totp_factors (
  user_id         uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  secret_enc      bytea NOT NULL,
  confirmed_at    timestamptz,
  last_time_step  bigint,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth.recovery_codes (
  id        bigserial PRIMARY KEY,
  user_id   uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at   timestamptz
);
CREATE INDEX recovery_codes_user_idx ON auth.recovery_codes (user_id);

CREATE TABLE auth.passkeys (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key    bytea NOT NULL,
  counter       bigint NOT NULL DEFAULT 0,
  transports    text[],
  device_type   text,
  backed_up     boolean NOT NULL DEFAULT false,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);
CREATE INDEX passkeys_user_idx ON auth.passkeys (user_id);

CREATE TABLE auth.webauthn_challenges (
  id         uuid PRIMARY KEY,
  user_id    uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('register', 'login')),
  challenge  text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE auth.api_keys (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name         text NOT NULL,
  prefix       text NOT NULL UNIQUE,
  key_hash     text NOT NULL,
  scopes       text[] NOT NULL,
  expires_at   timestamptz,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_user_idx ON auth.api_keys (user_id);

CREATE TABLE auth.groups (
  id          uuid PRIMARY KEY,
  name        text NOT NULL,
  source      text NOT NULL CHECK (source IN ('local', 'scim', 'sso')),
  external_id text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX groups_source_name_key ON auth.groups (source, lower(name));
CREATE UNIQUE INDEX groups_source_external_key ON auth.groups (source, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE auth.group_members (
  group_id uuid NOT NULL REFERENCES auth.groups (id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user_idx ON auth.group_members (user_id);

CREATE TABLE auth.idp_providers (
  id                uuid PRIMARY KEY,
  slug              text NOT NULL UNIQUE,
  kind              text NOT NULL CHECK (kind IN ('oidc', 'oauth2', 'saml')),
  name              text NOT NULL,
  config            jsonb NOT NULL,
  client_secret_enc bytea,
  jit_provisioning  boolean NOT NULL DEFAULT true,
  trust_email       boolean NOT NULL DEFAULT false,
  group_claim       text,
  enabled           boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth.identities (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  provider_id   uuid NOT NULL REFERENCES auth.idp_providers (id) ON DELETE CASCADE,
  subject       text NOT NULL,
  email         text,
  claims        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  UNIQUE (provider_id, subject)
);
CREATE INDEX identities_user_idx ON auth.identities (user_id);

CREATE TABLE auth.sso_states (
  state         text PRIMARY KEY,
  provider_id   uuid NOT NULL REFERENCES auth.idp_providers (id) ON DELETE CASCADE,
  nonce         text,
  code_verifier text,
  expires_at    timestamptz NOT NULL
);

CREATE TABLE auth.scim_tokens (
  id           uuid PRIMARY KEY,
  name         text NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  created_by   uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
