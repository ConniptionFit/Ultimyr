-- Whether a quiz offers an on-screen calculator (as many vendor exams do), copied onto each attempt when it starts.
ALTER TABLE quiz.quiz_config ADD COLUMN calculator boolean NOT NULL DEFAULT false;
ALTER TABLE quiz.attempts ADD COLUMN calculator boolean NOT NULL DEFAULT false;
