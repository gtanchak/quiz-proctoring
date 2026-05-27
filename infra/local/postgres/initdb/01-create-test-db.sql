-- Runs once on first container start (Postgres docker-entrypoint-initdb.d).
-- The dev database (proctoring_dev) is created from POSTGRES_DB; this adds the
-- isolated database used by the automated test suite.
CREATE DATABASE proctoring_test;
