-- Optional hardening for existing/external Postgres servers.
-- Run once as a superuser or database owner. Each service gets a role limited to its own schema.
-- (Phase 1 ships the auth service only; more roles arrive with each service.)
--
-- psql "$ADMIN_URL" -v auth_password="'change-me'" -f deploy/postgres/roles.sql

CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ultimyr_auth') THEN
    CREATE ROLE ultimyr_auth LOGIN;
  END IF;
END $$;

ALTER ROLE ultimyr_auth PASSWORD :auth_password;
GRANT USAGE, CREATE ON SCHEMA auth TO ultimyr_auth;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO ultimyr_auth;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON SEQUENCES TO ultimyr_auth;
REVOKE ALL ON SCHEMA public FROM ultimyr_auth;
-- The migration runner records applied migrations in public.ultimyr_migrations.
GRANT USAGE, CREATE ON SCHEMA public TO ultimyr_auth;
