import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../config.js";
import {
  auditLog,
  emailVerificationTokens,
  organizations,
  passwordResetTokens,
  sessions,
  users,
} from "./schema/accounts.js";
import { apiKeys } from "./schema/api-keys.js";
import {
  attempts,
  questions,
  responses,
  testInvites,
  tests,
} from "./schema/tests.js";

/**
 * Drizzle schema object. Table modules are imported directly (rather than via a
 * barrel) so drizzle-kit can read the plain table files without tripping over
 * Node-ESM `.js` import specifiers. Add new tables here as they are created.
 */
const schema = {
  apiKeys,
  tests,
  questions,
  attempts,
  testInvites,
  responses,
  organizations,
  users,
  sessions,
  emailVerificationTokens,
  passwordResetTokens,
  auditLog,
};

/**
 * Shared PostgreSQL connection pool. `pg.Pool` connects lazily — constructing
 * it does not open a socket, so importing this module never requires a running
 * database (the connection happens on the first query).
 */
export const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

export const db = drizzle(pool, { schema });

export type Database = typeof db;
