-- Learners can tell the authors a question is wrong, unclear or out of date. One open report per person per question.
CREATE TABLE quiz.question_reports (
  id uuid PRIMARY KEY,
  question_id uuid NOT NULL REFERENCES quiz.questions(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  archive_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('wrong_answer', 'unclear', 'typo', 'outdated', 'other')),
  message text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX question_reports_one_open ON quiz.question_reports (user_id, question_id) WHERE status = 'open';
CREATE INDEX question_reports_item ON quiz.question_reports (item_id, status);
