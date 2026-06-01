import type { Role } from "@proctoring/shared";
import { eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { db } from "../db/client.js";
import { apiKeys } from "../db/schema/api-keys.js";
import { hashApiKey, hashesMatch, prefixOf } from "../lib/api-key.js";
import { AppError } from "../lib/errors.js";
import { resolveSession, touchSession } from "../lib/session.js";
import { TOKEN_TAGS } from "../lib/token.js";

/**
 * The authenticated identity attached to every `/v1` request (except the
 * candidate-facing `/v1/public/*` and the open `/v1/auth/*` endpoints).
 *
 * Both credential kinds resolve to the same shape so downstream handlers scope
 * by `orgId` and gate by `role` uniformly:
 * - a user **session** carries the user's id, org, and role;
 * - an **API key** is a machine actor mapped to the `owner` role (full access
 *   within its org), preserving the pre-accounts behaviour where a key could do
 *   everything for its tenant.
 */
export interface RequestAuth {
  orgId: string;
  actorType: "user" | "apiKey";
  role: Role;
  userId?: string;
  apiKeyId?: string;
  sessionId?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: RequestAuth | null;
  }
}

const API_KEY_TAG = "proct_";

/**
 * Resolves the request's `Authorization: Bearer <token>` into `request.auth`,
 * or throws 401/403. Exported so per-route guards (e.g. `requireSession` for
 * the self-authenticating `/v1/auth/*` routes) can reuse it.
 */
export async function authenticateRequest(request: FastifyRequest): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw AppError.unauthorized("Missing or malformed Authorization header");
  }
  const token = header.slice("Bearer ".length).trim();
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
    request.auth = {
      orgId: user.orgId,
      actorType: "user",
      role: user.role,
      userId: user.id,
      sessionId: session.id,
    };
    void touchSession(session).catch((err) =>
      request.log.warn({ err }, "failed to slide session expiry"),
    );
    return;
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
    request.auth = {
      orgId: row.orgId,
      actorType: "apiKey",
      role: "owner",
      apiKeyId: row.id,
    };
    // Best-effort usage tracking; never block or fail the request on it.
    void db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.id))
      .catch((err) => request.log.warn({ err }, "failed to update last_used_at"));
    return;
  }

  throw AppError.unauthorized("Invalid credentials");
}

/**
 * Registers authentication. Every `/v1` route requires a valid Bearer token —
 * either a session token (`sess_…`) or an API key (`proct_…`) — except:
 * - `/v1/public/*`: the candidate surface, which authenticates candidates itself;
 * - `/v1/auth/*`: sign-up/login/etc., which are open or self-authenticate.
 * Runs as an early global onRequest hook so downstream hooks (e.g. rate
 * limiting) can key off the authenticated identity.
 */
export const authPlugin = fp(
  async (app) => {
    app.decorateRequest("auth", null);

    app.addHook("onRequest", async (request) => {
      const path = request.url.split("?")[0];
      const isV1 = path === "/v1" || path.startsWith("/v1/");
      const isPublic = path === "/v1/public" || path.startsWith("/v1/public/");
      const isAuth = path === "/v1/auth" || path.startsWith("/v1/auth/");
      if (isV1 && !isPublic && !isAuth) {
        await authenticateRequest(request);
      }
    });
  },
  { name: "auth" },
);
