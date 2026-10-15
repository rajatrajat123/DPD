-- backend/scripts/setup_dev_databases.sql
-- Least-privilege PostgreSQL setup for Aura platform development.
-- Execute using superuser 'postgres' via pgAdmin Query Tool or psql.

-- 1. Create dedicated application role without elevated privileges
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aura') THEN
        CREATE ROLE aura WITH LOGIN;
    END IF;
END $$;

-- 2. Set strong application password (replace with your chosen local password)
-- In psql, run: \password aura
-- Or in pgAdmin Query Tool:
ALTER ROLE aura WITH PASSWORD '<CHOSEN_STRONG_LOCAL_PASSWORD>';
ALTER ROLE aura NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

-- 3. Create development and test databases (execute outside transaction blocks)
-- In interactive psql (\i or psql console), the \gexec meta-command executes conditional creation:
SELECT 'CREATE DATABASE aura_dev OWNER aura'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'aura_dev')\gexec

SELECT 'CREATE DATABASE aura_test OWNER aura'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'aura_test')\gexec

-- Note for pgAdmin Query Tool: Run directly if not already present:
-- CREATE DATABASE aura_dev OWNER aura;
-- CREATE DATABASE aura_test OWNER aura;

-- 4. In database 'aura_dev' (connect as postgres / superuser):
\c aura_dev
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "postgis";
GRANT ALL ON SCHEMA public TO aura;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO aura;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO aura;

-- 5. In database 'aura_test' (connect as postgres / superuser):
\c aura_test
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "postgis";
GRANT ALL ON SCHEMA public TO aura;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO aura;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO aura;
