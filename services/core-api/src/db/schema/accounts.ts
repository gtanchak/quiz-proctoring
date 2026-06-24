import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Accounts, authentication, and audit (PRO-39).
 *
 * Co-located in one module because these tables have database-level foreign
 * keys to each other (users→org, sessions→users, tokens→users, audit→org). The
 * same drizzle-kit limitation that groups tests.ts applies: it cannot follow
 * cross-file `.js` import specifiers when generating migrations, so intra-file
 * FKs use `.references()` while cross-file references (e.g. api_keys.org_id,
 * tests.org_id pointing at organizations) are plain uuid columns whose FK
 * constraints are added by hand in the migration SQL — matching the existing
 * `owner_key_id` convention.
 */

/**
 * Account roles. These literals MUST match `ROLES` in @proctoring/shared (the
 * cross-boundary contract); they're inlined here rather than imported because
 * drizzle-kit parses this file directly and cannot resolve the workspace
 * package. A test asserts the two stay in sync (see test/role-enum-sync.test.ts).
 */
export const userRole = pgEnum("user_role", [
  "platform_admin",
  "tenant_admin",
  "recruiter",
  "reviewer",
  "candidate",
]);

/** Who/what performed an audited action. */
export const auditActorType = pgEnum("audit_actor_type", [
  "user",
  "apiKey",
  "system",
]);

/** An account / tenant. Created by signup; every user and API key belongs to one. */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Admin users. Email is globally unique (login takes no org selector). The
 * password is stored only as a scrypt hash (lib/password.ts) — never raw.
 * `emailVerifiedAt` gates login; `deletedAt` is a soft delete.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Plain uuid → FK to organizations added in the migration SQL (cross-file).
    orgId: uuid("org_id").notNull(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    role: userRole("role").notNull(),
    passwordHash: text("password_hash").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("users_org_id_idx").on(t.orgId)],
);

/**
 * Opaque, revocable login sessions. The raw `sess_…` token is never stored —
 * only its SHA-256 hash plus an indexed lookup prefix (lib/token.ts).
 * `expiresAt` slides forward on use; revocation is a soft delete.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Absolute cap — a session can never be slid past this regardless of use.
    absoluteExpiresAt: timestamp("absolute_expires_at", {
      withTimezone: true,
    }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

/** Single-use email-verification tokens (`verify_…`). */
export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("email_verification_tokens_user_id_idx").on(t.userId)],
);

/** Single-use password-reset tokens (`reset_…`). */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("password_reset_tokens_user_id_idx").on(t.userId)],
);

/**
 * Append-only audit log of security-relevant actions (login, role change,
 * evidence deletion, …). Never stores secrets, PII, or evidence URLs — only
 * stable action codes and opaque target ids. `org_id`/`actor_user_id` are plain
 * uuids; their FK constraints are added in the migration SQL.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    actorUserId: uuid("actor_user_id"),
    actorType: auditActorType("actor_type").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("audit_log_org_id_created_at_idx").on(t.orgId, t.createdAt)],
);

export type OrganizationRow = typeof organizations.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type EmailVerificationTokenRow =
  typeof emailVerificationTokens.$inferSelect;
export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
