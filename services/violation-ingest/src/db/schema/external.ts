import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Read-only references to tables **owned and migrated by core-api**, declared
 * here so this service can authenticate over the shared Postgres instance. Only
 * the columns we read are listed. These are intentionally NOT in
 * `drizzle.config.ts`'s schema glob, so drizzle-kit never tries to create or
 * alter them.
 */

export const attempts = pgTable("attempts", {
  id: uuid("id").primaryKey(),
  status: text("status").notNull(),
  sessionTokenHash: text("session_token_hash"),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
