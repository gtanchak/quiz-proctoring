import { eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { apiKeys, attempts } from "./db/schema/external.js";
import { AppError } from "./lib/errors.js";
import { apiKeyPrefix, hexEqual, sha256Hex } from "./lib/hash.js";

function bearer(authorization: string | undefined): string {
  if (!authorization?.startsWith("Bearer ")) {
    throw AppError.unauthorized("Missing bearer token");
  }
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    throw AppError.unauthorized();
  }
  return token;
}

export interface AuthedAttempt {
  attemptId: string;
  status: string;
}

/**
 * Authenticates a candidate by their per-attempt session token (issued by
 * core-api at attempt start, PRO-8), looked up in the shared `attempts` table.
 */
export async function authenticateAttempt(
  authorization: string | undefined,
): Promise<AuthedAttempt> {
  const token = bearer(authorization);
  const [row] = await db
    .select({ id: attempts.id, status: attempts.status })
    .from(attempts)
    .where(eq(attempts.sessionTokenHash, sha256Hex(token)))
    .limit(1);
  if (!row) {
    throw AppError.unauthorized("Invalid attempt session token");
  }
  return { attemptId: row.id, status: row.status };
}

/**
 * Authenticates an admin/service caller by API key (the read API for reporting),
 * validated against the shared `api_keys` table.
 */
export async function authenticateAdmin(
  authorization: string | undefined,
): Promise<{ id: string }> {
  const token = bearer(authorization);
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyPrefix, apiKeyPrefix(token)))
    .limit(1);
  if (!row || row.revokedAt || !hexEqual(row.keyHash, sha256Hex(token))) {
    throw AppError.unauthorized("Invalid API key");
  }
  return { id: row.id };
}
