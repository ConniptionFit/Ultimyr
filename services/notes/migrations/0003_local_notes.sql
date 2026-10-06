-- Notes now live in Ultimyr. Fast Note Sync (Obsidian) is an optional two-way mirror of the same text.
-- content/hash describe the text kept here (hash = sha-256 of content). pushed_hash is the hash that was last in step with
-- the vault and remote_hash is the vault's own hash for it at that moment; both are null until a first sync.
CREATE TABLE notes.step_text (
  user_id uuid NOT NULL,
  step_id uuid NOT NULL,
  archive_id uuid NOT NULL,
  content text NOT NULL DEFAULT '',
  hash text NOT NULL,
  pushed_hash text,
  remote_hash text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, step_id)
);
CREATE INDEX step_text_archive_idx ON notes.step_text (user_id, archive_id);
