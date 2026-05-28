import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../config.js";
import { apiKeys, attempts } from "./schema/external.js";
import { violations } from "./schema/violations.js";

const schema = { violations, attempts, apiKeys };

/** Shared pool (lazy connect). Same Postgres as core-api; see schema/external.ts. */
export const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

export const db = drizzle(pool, { schema });
