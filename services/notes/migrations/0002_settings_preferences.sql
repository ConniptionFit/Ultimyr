-- Instance-wide settings an administrator can change in the web app (the Fast Note Sync address), so a plain
-- `docker compose up` needs no extra environment variable. An address set in the environment always wins.
CREATE TABLE notes.instance_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

-- How each person wants notes to work. Follows them across devices.
CREATE TABLE notes.preferences (
  user_id uuid PRIMARY KEY,
  root_folder text NOT NULL DEFAULT 'Ultimyr',
  editor text NOT NULL DEFAULT 'ultimyr' CHECK (editor IN ('ultimyr', 'obsidian')),
  pane text NOT NULL DEFAULT 'split' CHECK (pane IN ('split', 'full', 'off')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
