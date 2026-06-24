import type { Role } from "@proctoring/shared";

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

declare module "express" {
  interface Request {
    auth?: RequestAuth | null;
    /**
     * The resolved tenant id for the request (the org id), set by TenantGuard
     * on authenticated `/v1` routes. The `organizations` table is the tenant
     * boundary (ADR 0002: shared-schema + tenant_id).
     */
    tenantId?: string;
  }
}
