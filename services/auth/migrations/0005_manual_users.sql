-- Admin-created accounts: a forced password change on first sign-in, and one-time invite / set-password links.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS auth.password_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_tokens_user_idx ON auth.password_tokens (user_id);
