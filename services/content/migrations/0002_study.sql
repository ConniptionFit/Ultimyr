-- Spaced repetition: per-person schedule for every flashcard they study, plus a review log.
CREATE TABLE content.study_settings (
  user_id uuid PRIMARY KEY,
  desired_retention real NOT NULL DEFAULT 0.9 CHECK (desired_retention BETWEEN 0.7 AND 0.99),
  new_per_day int NOT NULL DEFAULT 20 CHECK (new_per_day BETWEEN 0 AND 500),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE content.srs_state (
  user_id uuid NOT NULL,
  card_id uuid NOT NULL REFERENCES content.cards(id) ON DELETE CASCADE,
  deck_id uuid NOT NULL,
  archive_id uuid NOT NULL,
  state smallint NOT NULL CHECK (state BETWEEN 0 AND 3),  -- 0 new, 1 learning, 2 review, 3 relearning
  stability real NOT NULL,
  difficulty real NOT NULL,
  reps int NOT NULL DEFAULT 0,
  lapses int NOT NULL DEFAULT 0,
  last_review timestamptz,
  due timestamptz NOT NULL,
  PRIMARY KEY (user_id, card_id)
);
CREATE INDEX srs_state_due ON content.srs_state (user_id, due);
CREATE INDEX srs_state_archive ON content.srs_state (user_id, archive_id);

CREATE TABLE content.srs_reviews (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  card_id uuid NOT NULL,
  archive_id uuid NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 4),
  state_before smallint NOT NULL,
  elapsed_days real,
  scheduled_days real NOT NULL,
  duration_ms int NOT NULL DEFAULT 0,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX srs_reviews_user ON content.srs_reviews (user_id, reviewed_at DESC);
