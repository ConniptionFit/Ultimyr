-- One-time setup on your existing Postgres: a dedicated role and database for Ultimyr.
-- Run it as a superuser; it is safe to run again.
--
--   docker exec -i postgres psql -U postgres -v pw="$(cat secrets/pg_password)" < deploy/postgres/setup.sql
--
-- (-v pw=... must be the same value as secrets/pg_password, which the api container reads.)
--
-- Each Ultimyr service keeps its tables in its own schema inside this database: auth, content, quiz, ai and notes.
-- The role owns the database, so it can create those schemas and the migration log (public.ultimyr_migrations) itself.
-- It has no access to any other database on the server.

SELECT format('CREATE ROLE ultimyr LOGIN PASSWORD %L', :'pw')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ultimyr') \gexec

SELECT 'CREATE DATABASE ultimyr OWNER ultimyr'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ultimyr') \gexec

-- Other apps' databases stay closed to this role (PUBLIC can connect by default on a stock Postgres).
REVOKE ALL ON DATABASE ultimyr FROM PUBLIC;
GRANT ALL ON DATABASE ultimyr TO ultimyr;
