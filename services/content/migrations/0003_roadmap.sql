-- Roadmaps: external resources (links to videos, articles, courses) and one ordered path per archive.
CREATE TABLE content.resources (
  id uuid PRIMARY KEY,
  master_item_id uuid NOT NULL REFERENCES content.master_items(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'article' CHECK (kind IN ('video', 'playlist', 'article', 'course', 'docs', 'practice', 'book', 'podcast', 'other')),
  title text NOT NULL,
  url text NOT NULL,
  provider text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  minutes int CHECK (minutes IS NULL OR minutes BETWEEN 1 AND 6000),
  tags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  source text NOT NULL DEFAULT 'human' CHECK (source IN ('human', 'ai', 'mcp', 'import')),
  ord int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', title), 'A') ||
    setweight(to_tsvector('english', provider), 'B') ||
    setweight(to_tsvector('english', summary), 'C')
  ) STORED
);
CREATE UNIQUE INDEX resources_url ON content.resources (master_item_id, url) WHERE deleted_at IS NULL;
CREATE INDEX resources_archive ON content.resources (master_item_id, ord) WHERE deleted_at IS NULL;
CREATE INDEX resources_search ON content.resources USING gin (search);

-- One roadmap per archive. Draft and publish work like guides: MCP and AI writes wait for a person.
CREATE TABLE content.roadmaps (
  master_item_id uuid PRIMARY KEY REFERENCES content.master_items(id) ON DELETE CASCADE,
  summary text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  source text NOT NULL DEFAULT 'human' CHECK (source IN ('human', 'ai', 'mcp', 'import')),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE content.roadmap_stages (
  id uuid PRIMARY KEY,
  master_item_id uuid NOT NULL REFERENCES content.master_items(id) ON DELETE CASCADE,
  ord int NOT NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT ''
);
CREATE INDEX roadmap_stages_archive ON content.roadmap_stages (master_item_id, ord);

CREATE TABLE content.roadmap_steps (
  id uuid PRIMARY KEY,
  stage_id uuid NOT NULL REFERENCES content.roadmap_stages(id) ON DELETE CASCADE,
  master_item_id uuid NOT NULL REFERENCES content.master_items(id) ON DELETE CASCADE,
  ord int NOT NULL,
  kind text NOT NULL CHECK (kind IN ('item', 'resource', 'milestone')),
  item_id uuid REFERENCES content.sub_items(id) ON DELETE CASCADE,
  resource_id uuid REFERENCES content.resources(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  required boolean NOT NULL DEFAULT true,
  minutes int CHECK (minutes IS NULL OR minutes BETWEEN 1 AND 6000),
  CHECK ((kind = 'item') = (item_id IS NOT NULL)),
  CHECK ((kind = 'resource') = (resource_id IS NOT NULL)),
  CHECK (kind <> 'milestone' OR title <> '')
);
CREATE INDEX roadmap_steps_stage ON content.roadmap_steps (stage_id, ord);
CREATE INDEX roadmap_steps_archive ON content.roadmap_steps (master_item_id);

-- A person's own ticks. Deleting a step (or an archive) removes them.
CREATE TABLE content.step_progress (
  user_id uuid NOT NULL,
  step_id uuid NOT NULL REFERENCES content.roadmap_steps(id) ON DELETE CASCADE,
  archive_id uuid NOT NULL REFERENCES content.master_items(id) ON DELETE CASCADE,
  done_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, step_id)
);
CREATE INDEX step_progress_archive ON content.step_progress (user_id, archive_id);
