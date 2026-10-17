-- A course glossary: terms and acronyms the exam expects you to know, each with a plain definition.
-- Terms written by AI or MCP start as drafts that only editors see, like other material.
CREATE TABLE content.glossary_terms (
  id uuid PRIMARY KEY,
  archive_id uuid NOT NULL REFERENCES content.master_items(id) ON DELETE CASCADE,
  term text NOT NULL,
  expansion text NOT NULL DEFAULT '',
  definition text NOT NULL,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  source text NOT NULL DEFAULT 'human',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX glossary_terms_unique ON content.glossary_terms (archive_id, lower(term));
