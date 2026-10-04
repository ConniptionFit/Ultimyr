-- Roadmap steps can contain steps: a course holds lessons, a lesson holds pages.
-- Only leaf steps carry a person's tick; a parent is done when everything under it is.
ALTER TABLE content.roadmap_steps ADD COLUMN parent_id uuid REFERENCES content.roadmap_steps(id) ON DELETE CASCADE;
CREATE INDEX roadmap_steps_parent ON content.roadmap_steps (parent_id);
