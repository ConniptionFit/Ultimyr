-- Tagging and icon choice. Tags are `namespace:value` strings attached to archives, roadmap stages and steps,
-- resources, guides/decks/quizzes and exam objectives. Targets are polymorphic (no foreign key to the target),
-- so reads join to live rows and deleting an archive removes its tags. Nothing here changes existing rows' behaviour.
CREATE TABLE content.tag_links (
  archive_id uuid NOT NULL REFERENCES content.master_items(id) ON DELETE CASCADE,
  target_kind text NOT NULL CHECK (target_kind IN ('archive', 'stage', 'step', 'resource', 'item', 'objective')),
  target_id uuid NOT NULL,
  tag text NOT NULL CHECK (tag ~ '^[a-z0-9][a-z0-9-]{0,39}:[a-z0-9][a-z0-9-]{0,39}$'),
  PRIMARY KEY (target_kind, target_id, tag)
);
CREATE INDEX tag_links_archive ON content.tag_links (archive_id);
CREATE INDEX tag_links_tag ON content.tag_links (tag, archive_id);

-- Where an icon came from. 'user' is never replaced automatically; 'auto' and 'none'/'default' may be.
ALTER TABLE content.master_items ADD COLUMN icon_source text NOT NULL DEFAULT 'default' CHECK (icon_source IN ('default', 'auto', 'user'));
UPDATE content.master_items SET icon_source = 'user' WHERE icon_kind = 'upload' OR icon_name <> 'book-open';

ALTER TABLE content.roadmap_stages ADD COLUMN icon_name text, ADD COLUMN icon_source text NOT NULL DEFAULT 'none' CHECK (icon_source IN ('none', 'auto', 'user'));
ALTER TABLE content.roadmap_steps ADD COLUMN icon_name text, ADD COLUMN icon_source text NOT NULL DEFAULT 'none' CHECK (icon_source IN ('none', 'auto', 'user'));
