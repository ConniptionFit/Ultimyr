-- A person's own marks on a question: a bookmark that survives across attempts, and a private note.
CREATE TABLE quiz.question_marks (
  user_id uuid NOT NULL,
  question_id uuid NOT NULL REFERENCES quiz.questions(id) ON DELETE CASCADE,
  archive_id uuid NOT NULL,
  bookmarked boolean NOT NULL DEFAULT false,
  note text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);
CREATE INDEX question_marks_user ON quiz.question_marks (user_id, archive_id);
