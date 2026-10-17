-- Per-person card controls: suspend a card (hide it until you bring it back) or bury it until a time,
-- plus an option to suspend leeches (cards forgotten again and again) automatically.
CREATE TABLE content.card_flags (
  user_id uuid NOT NULL,
  card_id uuid NOT NULL REFERENCES content.cards(id) ON DELETE CASCADE,
  archive_id uuid NOT NULL,
  suspended boolean NOT NULL DEFAULT false,
  buried_until timestamptz,
  PRIMARY KEY (user_id, card_id)
);
CREATE INDEX card_flags_user ON content.card_flags (user_id, archive_id);
ALTER TABLE content.study_settings ADD COLUMN leech_suspend boolean NOT NULL DEFAULT false;
