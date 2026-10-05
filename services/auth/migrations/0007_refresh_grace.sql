-- When the current refresh token replaced the previous one. Lets a refresh that raced a rotation (two tabs) through.
ALTER TABLE auth.sessions ADD COLUMN IF NOT EXISTS rotated_at timestamptz;
