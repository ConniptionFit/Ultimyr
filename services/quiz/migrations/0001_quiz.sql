-- Quiz service: questions, quiz settings, scoring profiles and attempts.
-- Quizzes themselves are items in the content service; this schema stores what is inside them.
CREATE SCHEMA IF NOT EXISTS quiz;

CREATE TABLE quiz.scoring_profiles (
  id uuid PRIMARY KEY,
  owner_id uuid,                       -- null for official profiles
  name text NOT NULL,
  version int NOT NULL DEFAULT 1,
  definition jsonb NOT NULL,           -- immutable once written
  checksum text NOT NULL,
  is_official boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX scoring_profiles_official_uq ON quiz.scoring_profiles (name, version) WHERE is_official;
CREATE INDEX scoring_profiles_owner_ix ON quiz.scoring_profiles (owner_id);

CREATE TABLE quiz.quiz_config (
  item_id uuid PRIMARY KEY,            -- content.sub_items.id (kind quiz)
  archive_id uuid NOT NULL,
  mode text NOT NULL DEFAULT 'practice' CHECK (mode IN ('practice', 'timed', 'exam_sim')),
  time_limit_s int CHECK (time_limit_s IS NULL OR time_limit_s BETWEEN 60 AND 28800),
  question_count int CHECK (question_count IS NULL OR question_count BETWEEN 1 AND 500),
  shuffle_questions boolean NOT NULL DEFAULT true,
  shuffle_options boolean NOT NULL DEFAULT true,
  scoring_profile_id uuid REFERENCES quiz.scoring_profiles(id),
  grace_s int NOT NULL DEFAULT 10 CHECK (grace_s BETWEEN 0 AND 300),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quiz.questions (
  id uuid PRIMARY KEY,
  item_id uuid NOT NULL,
  archive_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('mcq', 'multi', 'fib', 'dnd', 'pbq')),
  stem text NOT NULL,
  payload jsonb NOT NULL,
  answer_key jsonb NOT NULL,
  explanation text NOT NULL DEFAULT '',
  difficulty smallint CHECK (difficulty IS NULL OR difficulty BETWEEN 1 AND 5),
  domain text,
  weight int NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 100),
  is_pretest boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  source text NOT NULL DEFAULT 'human' CHECK (source IN ('human', 'ai', 'mcp', 'import')),
  version int NOT NULL DEFAULT 1,
  ord int NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX questions_item_ix ON quiz.questions (item_id, ord);

CREATE TABLE quiz.attempts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  item_id uuid NOT NULL,
  archive_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('practice', 'timed', 'exam_sim')),
  profile_id uuid,
  profile_snapshot jsonb NOT NULL,      -- results never change when a profile is later replaced
  seed text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz,
  grace_s int NOT NULL DEFAULT 0,
  submitted_at timestamptz,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'expired')),
  raw_earned int,
  raw_max int,
  raw_bp int,
  scaled int,
  pass boolean,
  breakdown jsonb
);
CREATE INDEX attempts_user_ix ON quiz.attempts (user_id, started_at DESC);
CREATE INDEX attempts_item_ix ON quiz.attempts (item_id, user_id);

CREATE TABLE quiz.attempt_items (
  attempt_id uuid NOT NULL REFERENCES quiz.attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL,
  ord int NOT NULL,
  question jsonb NOT NULL,              -- full snapshot incl. answer key, so edits never change a past attempt
  presented jsonb NOT NULL,             -- what the learner saw (shuffled, no key)
  response jsonb,
  flagged boolean NOT NULL DEFAULT false,
  time_ms int NOT NULL DEFAULT 0,
  revealed boolean NOT NULL DEFAULT false,
  points_awarded int,
  outcome text,
  grading jsonb,
  PRIMARY KEY (attempt_id, question_id)
);
