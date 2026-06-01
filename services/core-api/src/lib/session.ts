import { and, eq, isNull } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import {
  type SessionRow,
  type UserRow,
  sessions,
  users,
} from "../db/schema/accounts.js";
import {
  TOKEN_TAGS,
  generateToken,
  hashToken,
  tokenHashesMatch,
  tokenPrefix,
} from "./token.js";

/**
 * Opaque, DB-backed login sessions (PRO-39).
 *
 * A session is identified by a `sess_…` bearer token whose hash + indexed
 * prefix are stored (the raw token is returned once at login). Sessions slide
 * forward on use up to an absolute cap, and are revoked (soft-deleted) on
 * logout, password reset, and password change.
 */
export interface CreatedSession {
  token: string;
  expiresAt: Date;
  sessionId: string;
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<CreatedSession> {
  const { token, prefix, hash } = generateToken(TOKEN_TAGS.session);
  const now = Date.now();
  const expiresAt = new Date(now + config.SESSION_TTL * 1000);
  const absoluteExpiresAt = new Date(now + config.SESSION_ABS_TTL * 1000);
  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: hash,
      tokenPrefix: prefix,
      expiresAt,
      absoluteExpiresAt,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
    })
    .returning({ id: sessions.id });
  return { token, expiresAt, sessionId: row.id };
}

export interface ResolvedSession {
  session: SessionRow;
  user: UserRow;
}

/**
 * Resolves a session token to its session + user, or null if the token is
 * unknown, tampered, revoked, expired, past its absolute cap, or the user is
 * soft-deleted. Constant-time hash compare; the prefix only narrows the lookup.
 */
export async function resolveSession(
  token: string,
): Promise<ResolvedSession | null> {
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenPrefix, tokenPrefix(token)))
    .limit(1);
  if (!row) {
    return null;
  }
  const { session, user } = row;
  if (!tokenHashesMatch(session.tokenHash, hashToken(token))) {
    return null;
  }
  const now = Date.now();
  if (
    session.revokedAt ||
    session.expiresAt.getTime() <= now ||
    session.absoluteExpiresAt.getTime() <= now ||
    user.deletedAt
  ) {
    return null;
  }
  return { session, user };
}

/**
 * Slides a session's expiry forward (capped at the absolute expiry), but only
 * once less than half the window remains — so authenticated requests don't each
 * incur a write. Best-effort; callers fire-and-forget.
 */
export async function touchSession(session: SessionRow): Promise<void> {
  const now = Date.now();
  const remaining = session.expiresAt.getTime() - now;
  if (remaining > (config.SESSION_TTL * 1000) / 2) {
    return;
  }
  const slid = Math.min(
    now + config.SESSION_TTL * 1000,
    session.absoluteExpiresAt.getTime(),
  );
  await db
    .update(sessions)
    .set({ expiresAt: new Date(slid), lastUsedAt: new Date(now) })
    .where(eq(sessions.id, session.id));
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.id, sessionId));
}

/** Revokes every active session for a user (on password reset/change). */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
