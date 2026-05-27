import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/**
 * Applies migrations to the test database once before the suite runs, so tests
 * run against the real schema. Uses its own pool (independent of the app's
 * client) and matches the DATABASE_URL set in vitest.config.ts.
 */
export default async function setup(): Promise<void> {
  const pool = new pg.Pool({
    connectionString:
      "postgres://proctoring:proctoring@localhost:5432/proctoring_test",
  });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }
}
