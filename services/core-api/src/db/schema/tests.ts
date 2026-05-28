import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
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

/** Who can open a test's share link: anyone with the link, or invited emails. */
export const accessMode = pgEnum("access_mode", ["open", "invite"]);

export const tests = pgTable("tests", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerKeyId: uuid("owner_key_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  instructions: text("instructions"),
  status: testStatus("status").notNull().default("draft"),
  // Shareable link id (opaque). Set at creation; the link only admits
  // candidates once the test is published and within its availability window.
  accessToken: text("access_token").unique(),
  accessMode: accessMode("access_mode").notNull().default("open"),
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
  // Hashed per-attempt candidate session credential (PRO-8). The raw token is
  // returned once when a candidate starts/resumes via a public link.
  sessionTokenHash: text("session_token_hash"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  // When the attempt's time expires. Computed server-side at start from the
  // test duration; null means untimed. The single source of truth for the timer.
  deadlineAt: timestamp("deadline_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  // Set when the attempt is graded on finalize (PRO-53). score is the sum of
  // awarded points (may be fractional with partial credit); maxScore is the sum
  // of all question points.
  score: real("score"),
  maxScore: real("max_score"),
  gradedAt: timestamp("graded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Allow-list of candidate emails for invite-only tests (PRO-8). Unused for
 * open-access tests. One row per (test, email).
 */
export const testInvites = pgTable(
  "test_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    testId: uuid("test_id")
      .notNull()
      .references(() => tests.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("test_invites_test_email_unique").on(t.testId, t.email)],
);

/**
 * A candidate's answer to one question within an attempt (PRO-53). Co-located
 * here because of its FKs to attempts and questions. `awardedPoints` is filled
 * in when the attempt is graded on finalize.
 */
export const responses = pgTable(
  "responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    selectedOptionIds: jsonb("selected_option_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    awardedPoints: real("awarded_points"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("responses_attempt_question_unique").on(t.attemptId, t.questionId)],
);

export type TestRow = typeof tests.$inferSelect;
export type QuestionRow = typeof questions.$inferSelect;
export type AttemptRow = typeof attempts.$inferSelect;
export type TestInviteRow = typeof testInvites.$inferSelect;
export type ResponseRow = typeof responses.$inferSelect;
