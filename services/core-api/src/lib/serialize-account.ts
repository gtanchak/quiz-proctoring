import type { OrganizationDto, UserDto } from "@proctoring/shared";
import type { OrganizationRow, UserRow } from "../db/schema/accounts.js";

/**
 * Row → DTO serializers for the accounts contract (PRO-39). Centralised so the
 * `/me`, auth, and org-member routes all emit identical, secret-free shapes
 * (never the password hash). Mirrors serializeTest/serializeAttempt.
 */
export function serializeUser(row: UserRow): UserDto {
  return {
    id: row.id,
    orgId: row.orgId,
    email: row.email,
    name: row.name,
    role: row.role,
    emailVerifiedAt: row.emailVerifiedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeOrg(row: OrganizationRow): OrganizationDto {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
  };
}
