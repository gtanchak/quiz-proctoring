import { eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { db } from "../db/client.js";
import { apiKeys } from "../db/schema/api-keys.js";
import { hashApiKey, hashesMatch, prefixOf } from "../lib/api-key.js";
import { AppError } from "../lib/errors.js";

/** The authenticated identity attached to a request. */
export interface AuthenticatedKey {
  id: string;
  name: string;
}

declare module "fastify" {
  interface FastifyRequest {
    apiKey: AuthenticatedKey | null;
  }
}

async function authenticate(request: FastifyRequest): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw AppError.unauthorized("Missing or malformed Authorization header");
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    throw AppError.unauthorized();
  }

  const [row] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyPrefix, prefixOf(token)))
    .limit(1);

  if (!row || row.revokedAt || !hashesMatch(row.keyHash, hashApiKey(token))) {
    throw AppError.unauthorized("Invalid API key");
  }

  request.apiKey = { id: row.id, name: row.name };

  // Best-effort usage tracking; never block or fail the request on it.
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch((err) => request.log.warn({ err }, "failed to update last_used_at"));
}

/**
 * Registers API-key authentication. Every `/v1` route requires a valid
 * `Authorization: Bearer <key>`; unversioned routes (/health, /docs) stay open.
 * Runs as an early global onRequest hook so downstream hooks (e.g. rate
 * limiting) can key off the authenticated identity.
 */
export const authPlugin = fp(
  async (app) => {
    app.decorateRequest("apiKey", null);

    app.addHook("onRequest", async (request) => {
      if (request.url === "/v1" || request.url.startsWith("/v1/")) {
        await authenticate(request);
      }
    });
  },
  { name: "auth" },
);
