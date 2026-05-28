import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.js";

/**
 * Applies this service's migrations. Uses a dedicated migrations table so it
 * tracks its journal independently of core-api in the shared database.
 */
await migrate(db, {
  migrationsFolder: "./drizzle",
  migrationsTable: "__drizzle_migrations_violation_ingest",
});
await pool.end();
