-- Phase 8: extra time on timed attempts. Self declared by the learner at the start; recorded so results can say so.
ALTER TABLE quiz.attempts ADD COLUMN extra_time_pct int NOT NULL DEFAULT 0 CHECK (extra_time_pct IN (0, 25, 50, 100));
