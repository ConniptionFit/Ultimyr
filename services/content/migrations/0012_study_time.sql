-- A person's own study time log: minutes against a course on a day, from the timer or typed in.
-- Useful for exams that ask for training hours (for example contact hours) and for seeing where time goes.
CREATE TABLE content.study_time (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  archive_id uuid NOT NULL REFERENCES content.master_items(id) ON DELETE CASCADE,
  day date NOT NULL,
  minutes int NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
  note text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('timer', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX study_time_user ON content.study_time (user_id, day DESC);
