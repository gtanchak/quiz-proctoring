import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.js";

/**
 * Applies pending Drizzle migrations from ./drizzle, then closes the pool.
 * Run via `pnpm db:migrate` (needs DATABASE_URL and a reachable Postgres).
 */
await migrate(db, { migrationsFolder: "./drizzle" });
await pool.end();
