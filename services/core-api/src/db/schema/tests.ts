import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Tests and their attempts.
 *
 * Co-located in one module because `attempts` has a database-level foreign key
 * to `tests`, and drizzle-kit cannot follow cross-file `.js` import specifiers
 * when generating migrations. `owner_key_id` (the tenant scope) is a plain uuid
 * rather than an FK to api_keys for the same reason — ownership is enforced in
 * the application layer.
 */

export const testStatus = pgEnum("test_status", [
  "draft",
  "published",
  "archived",
]);

export const tests = pgTable("tests", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerKeyId: uuid("owner_key_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: testStatus("status").notNull().default("draft"),
  durationSeconds: integer("duration_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const attemptStatus = pgEnum("attempt_status", [
  "in_progress",
  "submitted",
  "expired",
  "abandoned",
]);

export const attempts = pgTable("attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  testId: uuid("test_id")
    .notNull()
    .references(() => tests.id, { onDelete: "cascade" }),
  candidateEmail: text("candidate_email"),
  status: attemptStatus("status").notNull().default("in_progress"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type TestRow = typeof tests.$inferSelect;
export type AttemptRow = typeof attempts.$inferSelect;
