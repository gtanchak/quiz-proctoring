import { inArray } from "drizzle-orm";
import { db } from "../../src/db/client.js";
import {
  auditLog,
  organizations,
  users,
} from "../../src/db/schema/accounts.js";
import { apiKeys } from "../../src/db/schema/api-keys.js";
import { tests } from "../../src/db/schema/tests.js";
import { generateApiKey } from "../../src/lib/api-key.js";

/**
 * Shared test seed helpers (PRO-39). Since tenancy moved from the API-key id to
 * an organization, suites create an org and attach an API key to it; cleanup
 * tears the whole org down (tests/attempts cascade, plus users/sessions/audit).
 */
export interface SeededKey {
  orgId: string;
  token: string;
  keyId: string;
}

/** Creates an organization with a full-access API key. */
export async function seedOrgWithKey(name: string): Promise<SeededKey> {
  const [org] = await db
    .insert(organizations)
    .values({ name: `${name}-org` })
    .returning({ id: organizations.id });
  const key = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({ orgId: org.id, name, keyPrefix: key.prefix, keyHash: key.hash })
    .returning({ id: apiKeys.id });
  return { orgId: org.id, token: key.token, keyId: row.id };
}

/**
 * Removes everything owned by the given orgs. Order respects FKs: tests first
 * (cascades questions/attempts/responses/invites), then audit rows (no cascade
 * from org), then users (cascades sessions/tokens), then API keys, then the orgs.
 */
export async function cleanupOrgs(orgIds: string[]): Promise<void> {
  if (orgIds.length === 0) {
    return;
  }
  await db.delete(tests).where(inArray(tests.orgId, orgIds));
  await db.delete(auditLog).where(inArray(auditLog.orgId, orgIds));
  await db.delete(users).where(inArray(users.orgId, orgIds));
  await db.delete(apiKeys).where(inArray(apiKeys.orgId, orgIds));
  await db.delete(organizations).where(inArray(organizations.id, orgIds));
}
