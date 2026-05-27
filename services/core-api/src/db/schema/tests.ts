import {
  boolean,
  integer,
  jsonb,
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

/** A selectable MCQ option. Stored as jsonb; ids are server-assigned. */
export interface McqOption {
  id: string;
  text: string;
  imageUrl?: string;
}

export const questionType = pgEnum("question_type", [
  "mcq_single",
  "mcq_multiple",
]);

/**
 * How a multi-correct MCQ is scored:
 * - `all_or_nothing`: full points only if the selected set equals the correct set.
 * - `partial`: per-option credit (see lib/grading.ts).
 * (Single-correct questions are always all-or-nothing.)
 */
export const gradingMode = pgEnum("grading_mode", [
  "all_or_nothing",
  "partial",
]);

/**
 * Questions belonging to a test. PRO-5 created the linkage; PRO-6 adds the MCQ
 * fields. Later question types extend `questionType` and reuse these columns
 * (`options`/`correctOptionIds` are general enough for choice-based types).
 */
export const questions = pgTable("questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  testId: uuid("test_id")
    .notNull()
    .references(() => tests.id, { onDelete: "cascade" }),
  type: questionType("type").notNull(),
  prompt: text("prompt").notNull(),
  imageUrl: text("image_url"),
  options: jsonb("options").$type<McqOption[]>().notNull().default([]),
  correctOptionIds: jsonb("correct_option_ids")
    .$type<string[]>()
    .notNull()
    .default([]),
  gradingMode: gradingMode("grading_mode").notNull().default("all_or_nothing"),
  points: integer("points").notNull().default(1),
  negativeMarking: boolean("negative_marking").notNull().default(false),
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
  // When the attempt's time expires. Computed server-side at start from the
  // test duration; null means untimed. The single source of truth for the timer.
  deadlineAt: timestamp("deadline_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type TestRow = typeof tests.$inferSelect;
export type QuestionRow = typeof questions.$inferSelect;
export type AttemptRow = typeof attempts.$inferSelect;
