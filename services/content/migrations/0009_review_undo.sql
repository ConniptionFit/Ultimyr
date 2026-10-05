-- Remember the schedule a review replaced, so the last answer can be undone.
ALTER TABLE content.srs_reviews ADD COLUMN prev_state jsonb;
