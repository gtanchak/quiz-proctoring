import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The violations store — owned and migrated by this service.
 *
 * `id` is the client-generated event id from the shared schema, used as the
 * primary key so retried/duplicated events are idempotent (insert-or-ignore).
 * `type`/`severity` are stored as text (not enums) so new violation types
 * persist without a schema migration. `receivedAt` is the server-authoritative
 * receipt time (the event's own `startedAt` is the client's observed time).
 */
export const violations = pgTable(
  "violations",
  {
    id: uuid("id").primaryKey(),
    attemptId: uuid("attempt_id").notNull(),
    type: text("type").notNull(),
    severity: text("severity").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
    metadata: jsonb("metadata"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("violations_attempt_idx").on(t.attemptId)],
);

export type ViolationRow = typeof violations.$inferSelect;
