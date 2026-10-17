-- A mock exam is a full, timed, no-feedback attempt assembled across an archive's quizzes to follow the exam's domain weights.
-- Like a drill it reuses attempts with item_id set to the archive.
ALTER TABLE quiz.attempts DROP CONSTRAINT attempts_kind_check;
ALTER TABLE quiz.attempts ADD CONSTRAINT attempts_kind_check CHECK (kind IN ('quiz', 'drill', 'mock'));
