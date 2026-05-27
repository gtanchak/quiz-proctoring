import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Tests, their questions, and their attempts.
 *
 * Co-located in one module because the tables have database-level foreign keys
 * to each other, and drizzle-kit cannot follow cross-file `.js` import
 * specifiers when generating migrations. `owner_key_id` (the tenant scope) is a
 * plain uuid rather than an FK to api_keys for the same reason — ownership is
 * enforced in the application layer.
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
  instructions: text("instructions"),
  status: testStatus("status").notNull().default("draft"),
  durationMinutes: integer("duration_minutes"),
  // Availability window (when candidates may take the test).
  availableFrom: timestamp("available_from", { withTimezone: true }),
  availableUntil: timestamp("available_until", { withTimezone: true }),
  maxAttempts: integer("max_attempts").notNull().default(1),
  // Scoring config. Per-question points live on the questions table.
  passMark: integer("pass_mark"),
  negativeMarking: boolean("negative_marking").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Questions belonging to a test. This is the minimal linkage entity (PRO-5);
 * concrete question types and authoring (MCQ, etc.) are added in PRO-6 and
 * later, which extend this table. Enough exists here to link, order, score, and
 * count questions — the last of which gates publishing.
 */
export const questions = pgTable("questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  testId: uuid("test_id")
    .notNull()
    .references(() => tests.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  points: integer("points").notNull().default(1),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
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
export type QuestionRow = typeof questions.$inferSelect;
export type AttemptRow = typeof attempts.$inferSelect;
