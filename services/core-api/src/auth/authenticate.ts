import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { apiKeys } from "../db/schema/api-keys.js";
import { hashApiKey, hashesMatch, prefixOf } from "../lib/api-key.js";
import { AppError } from "../lib/errors.js";
import { defaultLogger } from "../lib/logger.js";
import { resolveSession, touchSession } from "../lib/session.js";
import { TOKEN_TAGS } from "../lib/token.js";
import type { RequestAuth } from "./request-auth.js";

const API_KEY_TAG = "proct_";

/**
 * Resolves an `Authorization: Bearer <token>` header into a {@link RequestAuth},
 * or throws 401/403. Framework-agnostic (no request object) so it is shared by
 * the global {@link AuthGuard} and the per-route {@link SessionGuard}.
 *
 * Both credential kinds are accepted: a user session token (`sess_…`) and an
 * API key (`proct_…`).
 */
export async function authenticateToken(
  authorization: string | undefined,
): Promise<RequestAuth> {
  if (!authorization?.startsWith("Bearer ")) {
    throw AppError.unauthorized("Missing or malformed Authorization header");
  }
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    throw AppError.unauthorized();
  }

  if (token.startsWith(TOKEN_TAGS.session)) {
    const resolved = await resolveSession(token);
    if (!resolved) {
      throw AppError.unauthorized("Invalid or expired session");
    }
    const { session, user } = resolved;
    if (!user.emailVerifiedAt) {
      throw AppError.forbidden("Email not verified");
    }
    void touchSession(session).catch((err) =>
      defaultLogger.warn({ err }, "failed to slide session expiry"),
    );
    return {
      orgId: user.orgId,
      actorType: "user",
      role: user.role,
      userId: user.id,
      sessionId: session.id,
    };
  }

  if (token.startsWith(API_KEY_TAG)) {
    const [row] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyPrefix, prefixOf(token)))
      .limit(1);
    if (!row || row.revokedAt || !hashesMatch(row.keyHash, hashApiKey(token))) {
      throw AppError.unauthorized("Invalid API key");
    }
    // Best-effort usage tracking; never block or fail the request on it.
    void db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.id))
      .catch((err) =>
        defaultLogger.warn({ err }, "failed to update last_used_at"),
      );
    return {
      orgId: row.orgId,
      actorType: "apiKey",
      role: "owner",
      apiKeyId: row.id,
    };
  }

  throw AppError.unauthorized("Invalid credentials");
}
