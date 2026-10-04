-- Exam objectives: the official list of domains and objectives for an archive's certification, and which
-- material (guides, decks, cards, resources) supports each one. Practice questions link from the quiz service.
CREATE TABLE content.objectives (
  id uuid PRIMARY KEY,
  archive_id uuid NOT NULL REFERENCES content.master_items(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES content.objectives(id) ON DELETE CASCADE,
  ord int NOT NULL,
  code text NOT NULL DEFAULT '',
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  weight_bp int CHECK (weight_bp IS NULL OR weight_bp BETWEEN 0 AND 10000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX objectives_archive ON content.objectives (archive_id, ord);

-- Links are by id with no foreign key to the target (it may be an item, a card or a resource); queries join to live rows.
CREATE TABLE content.objective_links (
  objective_id uuid NOT NULL REFERENCES content.objectives(id) ON DELETE CASCADE,
  archive_id uuid NOT NULL REFERENCES content.master_items(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('item', 'card', 'resource')),
  ref_id uuid NOT NULL,
  PRIMARY KEY (objective_id, kind, ref_id)
);
CREATE INDEX objective_links_ref ON content.objective_links (kind, ref_id);
CREATE INDEX objective_links_archive ON content.objective_links (archive_id);
