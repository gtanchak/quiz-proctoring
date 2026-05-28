import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/**
 * Prepares an isolated test database for this service before the suite runs.
 *
 * violation-ingest shares a Postgres instance with core-api in production and
 * only *reads* core-api's `attempts`/`api_keys` tables (see
 * src/db/schema/external.ts). To keep the service's tests isolated from
 * core-api (CLAUDE.md §5) — and free of ordering flakiness against core-api's
 * real schema — they run against a dedicated database with minimal stand-ins
 * for those read-only tables, plus this service's own migrated `violations`.
 *
 * Must match the DATABASE_URL set in vitest.config.ts.
 */
const TEST_DB = "proctoring_violation_test";
const ADMIN_URL = "postgres://proctoring:proctoring@localhost:5432/proctoring_dev";
const TEST_URL = `postgres://proctoring:proctoring@localhost:5432/${TEST_DB}`;

export default async function setup(): Promise<void> {
  const admin = new pg.Pool({ connectionString: ADMIN_URL });
  try {
    const { rowCount } = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [TEST_DB],
    );
    if (!rowCount) {
      await admin.query(`CREATE DATABASE ${TEST_DB}`);
    }
  } finally {
    await admin.end();
  }

  const pool = new pg.Pool({ connectionString: TEST_URL });
  const db = drizzle(pool);
  try {
    // Minimal stand-ins for the core-api-owned tables this service
    // authenticates against (mirrors src/db/schema/external.ts).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attempts (
        id uuid PRIMARY KEY,
        status text NOT NULL,
        session_token_hash text
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS api_keys (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        key_prefix text NOT NULL,
        key_hash text NOT NULL,
        revoked_at timestamptz
      )
    `);
    // This service's own migrations (the violations table).
    await migrate(db, {
      migrationsFolder: "./drizzle",
      migrationsTable: "__drizzle_migrations_violation_ingest",
    });
  } finally {
    await pool.end();
  }
}
