-- Weak-area drills and exam objectives.
-- A drill is a practice attempt built from the questions a person is weakest on. It reuses attempts, with item_id set to the archive.
ALTER TABLE quiz.attempts ADD COLUMN kind text NOT NULL DEFAULT 'quiz' CHECK (kind IN ('quiz', 'drill'));
ALTER TABLE quiz.attempts ADD COLUMN drill jsonb;

-- Which exam objective (content.objectives, in the content service) a question tests. No foreign key across services.
ALTER TABLE quiz.questions ADD COLUMN objective_id uuid;
CREATE INDEX questions_objective ON quiz.questions (archive_id, objective_id) WHERE objective_id IS NOT NULL;
CREATE INDEX questions_archive ON quiz.questions (archive_id);

CREATE INDEX attempt_items_question ON quiz.attempt_items (question_id) WHERE outcome IS NOT NULL;
