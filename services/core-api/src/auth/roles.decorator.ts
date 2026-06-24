import { SetMetadata } from "@nestjs/common";
import { type Role, WRITE_ROLES } from "@proctoring/shared";

export const ROLES_KEY = "roles";

/**
 * Restricts a handler to the given roles (RBAC, PRO-39). Role failures return
 * **403** (the actor is authenticated; their lack of permission is not secret),
 * distinct from the cross-tenant **404** used when a resource isn't in the
 * actor's org. Assumes {@link AuthGuard} has populated `request.auth`.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Mutations (create/update/delete) require a write role; `viewer` is read-only. */
export const RequireWrite = () => Roles(...WRITE_ROLES);
