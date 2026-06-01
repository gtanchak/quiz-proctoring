import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * API keys for admin/API consumers. The raw key is never stored — only its
 * SHA-256 hash and an indexed lookup prefix. Revocation is a soft delete
 * (`revoked_at`) so we keep an audit trail.
 *
 * Each key belongs to an organization (PRO-39); a key authenticates as a full-
 * access actor within its org. `org_id` is a plain uuid (FK to organizations
 * added in the migration SQL) for the same cross-file reason as tests.org_id.
 */
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull().unique(),
  keyHash: text("key_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type ApiKeyRow = typeof apiKeys.$inferSelect;
