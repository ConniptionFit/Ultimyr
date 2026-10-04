-- Study goals. Analytics are computed from attempts on demand, so nothing else is stored.
CREATE TABLE quiz.goals (
  user_id uuid NOT NULL,
  archive_id uuid NOT NULL,
  target_bp int NOT NULL CHECK (target_bp BETWEEN 1 AND 10000),
  target_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, archive_id)
);
CREATE INDEX attempt_items_domain ON quiz.attempt_items (attempt_id) WHERE outcome IS NOT NULL;
