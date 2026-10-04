-- Instance-wide settings edited from the admin panel. One row per key, JSON value.
CREATE TABLE IF NOT EXISTS auth.instance_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
