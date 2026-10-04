-- AI gateway: the secret vault, preferences, jobs, usage and agent conversations.
-- Everything here is per user. Job and message rows never contain credentials.
CREATE SCHEMA IF NOT EXISTS ai;

-- One random data key per user, stored wrapped under the master key (KEK). Deleting the row shreds every secret of that user.
CREATE TABLE ai.user_deks (
  user_id uuid PRIMARY KEY,
  wrapped_dek bytea NOT NULL,
  kek_version int NOT NULL,
  dek_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz
);

CREATE TABLE ai.ai_credentials (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('gemini', 'openai', 'anthropic')),
  kind text NOT NULL DEFAULT 'api_key' CHECK (kind IN ('api_key')),
  label text NOT NULL,
  ciphertext bytea NOT NULL,
  dek_version int NOT NULL,
  last4 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX ai_credentials_user ON ai.ai_credentials (user_id) WHERE revoked_at IS NULL;

CREATE TABLE ai.ai_preferences (
  user_id uuid PRIMARY KEY,
  default_credential_id uuid,
  models jsonb NOT NULL DEFAULT '{}',   -- provider -> model name
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai.ai_jobs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('guide', 'deck', 'quiz')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  input jsonb NOT NULL,
  result jsonb,
  error text,
  provider text,
  model text,
  tokens_in int NOT NULL DEFAULT 0,
  tokens_out int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE INDEX ai_jobs_user ON ai.ai_jobs (user_id, created_at DESC);

CREATE TABLE ai.ai_usage (
  user_id uuid NOT NULL,
  day date NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  requests int NOT NULL DEFAULT 0,
  tokens_in bigint NOT NULL DEFAULT 0,
  tokens_out bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, provider, model)
);

CREATE TABLE ai.agent_threads (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'New conversation',
  context jsonb,                         -- what the person was looking at: { type: item | attempt, id }
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_threads_user ON ai.agent_threads (user_id, updated_at DESC);

CREATE TABLE ai.agent_messages (
  id uuid PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES ai.agent_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_messages_thread ON ai.agent_messages (thread_id, created_at);
