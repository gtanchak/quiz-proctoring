import { db } from "../db/client.js";
import { type LoggerLike, defaultLogger } from "./logger.js";
import { auditLog } from "../db/schema/accounts.js";

/**
 * Security audit log (PRO-39). Records security-relevant actions for human
 * review. Writes are best-effort — auditing must never block or fail the
 * request it describes — so callers use the fire-and-forget `recordAudit`
 * helper. Never put secrets, passwords, raw tokens, PII, or evidence URLs in
 * `metadata` (CLAUDE.md §6); use stable action codes and opaque ids only.
 */

/** Stable action codes. Extend as new audited actions are added. */
export const AuditAction = {
  ORG_CREATED: "org.created",
  USER_CREATED: "user.created",
  USER_EMAIL_VERIFIED: "user.email_verified",
  USER_EMAIL_VERIFICATION_REQUESTED: "user.email_verification_requested",
  USER_LOGIN: "user.login",
  USER_LOGOUT: "user.logout",
  USER_PASSWORD_RESET_REQUESTED: "user.password_reset_requested",
  USER_PASSWORD_RESET: "user.password_reset",
  USER_PASSWORD_CHANGED: "user.password_changed",
  USER_ROLE_CHANGED: "user.role_changed",
  USER_REMOVED: "user.removed",
  EVIDENCE_DELETED: "evidence.deleted",
  CANDIDATE_DATA_ERASED: "candidate.data_erased",
  RECOMMENDATION_OVERRIDDEN: "recommendation.overridden",
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditEntry {
  orgId: string;
  actorType: "user" | "apiKey" | "system";
  action: AuditAction;
  actorUserId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Awaitable write — used where the test or flow needs the row to exist. */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    orgId: entry.orgId,
    actorType: entry.actorType,
    action: entry.action,
    actorUserId: entry.actorUserId ?? null,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadata: entry.metadata ?? {},
  });
}

/**
 * Fire-and-forget audit write. Never throws; logs a warning if the insert
 * fails so a broken audit pipeline is visible without breaking the request.
 */
export function recordAudit(
  entry: AuditEntry,
  log: LoggerLike = defaultLogger,
): void {
  void writeAudit(entry).catch((err) => {
    log.warn({ err, action: entry.action }, "failed to write audit log entry");
  });
}
