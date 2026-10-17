-- How sure the person said they were when answering (1 guess, 2 not sure, 3 sure), for calibration feedback.
ALTER TABLE quiz.attempt_items ADD COLUMN confidence smallint CHECK (confidence BETWEEN 1 AND 3);
