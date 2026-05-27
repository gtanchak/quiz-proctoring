import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * API keys for admin/API consumers. The raw key is never stored — only its
 * SHA-256 hash and an indexed lookup prefix. Revocation is a soft delete
 * (`revoked_at`) so we keep an audit trail.
 *
 * Full account-based key management (issuing/listing/revoking through the admin
 * UI) belongs to the accounts system (PRO-39); this table is the storage layer.
 */
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
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
