CREATE SCHEMA IF NOT EXISTS notes;

-- One Fast Note Sync connection per person. The token is sealed with the operator's key and never returned by any route.
CREATE TABLE notes.connections (
  user_id uuid PRIMARY KEY,
  vault text NOT NULL,
  sealed_token bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Which note file belongs to which roadmap step. Keyed by step id so renaming a step never loses its note.
CREATE TABLE notes.step_notes (
  user_id uuid NOT NULL,
  step_id uuid NOT NULL,
  archive_id uuid NOT NULL,
  path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, step_id)
);
CREATE INDEX step_notes_archive ON notes.step_notes (user_id, archive_id);
