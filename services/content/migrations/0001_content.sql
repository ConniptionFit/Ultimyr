-- Content service: archives (master items), items (guides, decks, quizzes), versions, cards, grants.
CREATE SCHEMA IF NOT EXISTS content;

CREATE TABLE content.assets (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'icon',
  mime text NOT NULL,
  bytes bytea NOT NULL,
  sha256 text NOT NULL,
  width int,
  height int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE content.master_items (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  overview text NOT NULL DEFAULT '',
  vendor text,
  purchase_links jsonb NOT NULL DEFAULT '[]',
  validity_months int,
  quick_stats jsonb NOT NULL DEFAULT '{}',
  icon_kind text NOT NULL DEFAULT 'lucide' CHECK (icon_kind IN ('lucide', 'upload')),
  icon_name text NOT NULL DEFAULT 'book-open',
  icon_asset_id uuid REFERENCES content.assets(id) ON DELETE SET NULL,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared', 'org', 'public')),
  scoring_profile_id uuid,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', title), 'A') ||
    setweight(to_tsvector('english', coalesce(vendor, '')), 'B') ||
    setweight(to_tsvector('english', overview), 'C')
  ) STORED,
  UNIQUE (owner_id, slug)
);
CREATE INDEX master_items_search ON content.master_items USING gin (search);
CREATE INDEX master_items_owner ON content.master_items (owner_id) WHERE deleted_at IS NULL;

CREATE TABLE content.sub_items (
  id uuid PRIMARY KEY,
  master_item_id uuid NOT NULL REFERENCES content.master_items(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('guide', 'deck', 'quiz')),
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  owner_id uuid NOT NULL,
  current_version_id uuid,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  ai_status text NOT NULL DEFAULT 'none' CHECK (ai_status IN ('none', 'draft', 'reviewed')),
  ord int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', summary), 'B')
  ) STORED
);
CREATE INDEX sub_items_master ON content.sub_items (master_item_id) WHERE deleted_at IS NULL;
CREATE INDEX sub_items_search ON content.sub_items USING gin (search);

CREATE TABLE content.item_versions (
  id uuid PRIMARY KEY,
  sub_item_id uuid NOT NULL REFERENCES content.sub_items(id) ON DELETE CASCADE,
  version_no int NOT NULL,
  body jsonb NOT NULL,
  author_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'human' CHECK (source IN ('human', 'ai', 'mcp', 'import', 'restore')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sub_item_id, version_no)
);

CREATE TABLE content.guide_sections (
  version_id uuid NOT NULL REFERENCES content.item_versions(id) ON DELETE CASCADE,
  sub_item_id uuid NOT NULL REFERENCES content.sub_items(id) ON DELETE CASCADE,
  ord int NOT NULL,
  anchor text NOT NULL,
  heading text NOT NULL,
  md_body text NOT NULL,
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', heading), 'A') || setweight(to_tsvector('english', md_body), 'B')
  ) STORED,
  PRIMARY KEY (version_id, ord)
);
CREATE INDEX guide_sections_search ON content.guide_sections USING gin (search);
CREATE INDEX guide_sections_item ON content.guide_sections (sub_item_id);

CREATE TABLE content.cards (
  id uuid PRIMARY KEY,
  deck_id uuid NOT NULL REFERENCES content.sub_items(id) ON DELETE CASCADE,
  ord int NOT NULL DEFAULT 0,
  front text NOT NULL,
  back text NOT NULL,
  hint text,
  tags text[] NOT NULL DEFAULT '{}',
  media jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', front), 'A') || setweight(to_tsvector('english', back), 'B')
  ) STORED
);
CREATE INDEX cards_deck ON content.cards (deck_id, ord);
CREATE INDEX cards_search ON content.cards USING gin (search);

CREATE TABLE content.grants (
  id uuid PRIMARY KEY,
  object_type text NOT NULL CHECK (object_type IN ('archive', 'item')),
  object_id uuid NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('user', 'group')),
  subject_id uuid NOT NULL,
  relation text NOT NULL CHECK (relation IN ('attempt', 'viewer', 'editor', 'owner')),
  rank smallint GENERATED ALWAYS AS (
    CASE relation WHEN 'attempt' THEN 1 WHEN 'viewer' THEN 2 WHEN 'editor' THEN 3 ELSE 4 END
  ) STORED,
  created_by uuid NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (object_type, object_id, subject_type, subject_id, relation)
);
CREATE INDEX grants_object ON content.grants (object_type, object_id);
CREATE INDEX grants_subject ON content.grants (subject_type, subject_id);
