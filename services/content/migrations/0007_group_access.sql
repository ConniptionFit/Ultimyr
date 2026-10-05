-- Group access delegation: which people may manage group access for which archive (course).
-- Existing content is untouched: visibility and grants keep working exactly as before.
CREATE TABLE IF NOT EXISTS content.access_delegations (
  archive_id uuid NOT NULL REFERENCES content.master_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (archive_id, user_id)
);
CREATE INDEX IF NOT EXISTS access_delegations_user ON content.access_delegations (user_id);
