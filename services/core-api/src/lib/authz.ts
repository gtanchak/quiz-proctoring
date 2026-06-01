import { type Role, WRITE_ROLES } from "@proctoring/shared";
import type { preHandlerHookHandler } from "fastify";
import { authenticateRequest } from "../plugins/auth.js";
import { AppError } from "./errors.js";

/**
 * Role-based access control (PRO-39).
 *
 * Role checks deliberately return **403** (the actor is authenticated; their
 * lack of permission is not secret), which is distinct from the cross-tenant
 * **404** used when a resource isn't in the actor's org (see findOrgTest) — that
 * stays 404 to avoid leaking existence across tenants.
 */

/** Requires `request.auth.role` to be one of `allowed`. Assumes the global
 * auth hook has already populated `request.auth` (true for all `/v1` routes
 * outside `/v1/public` and `/v1/auth`). */
export function requireRole(...allowed: Role[]): preHandlerHookHandler {
  return async (request) => {
    if (!request.auth) {
      throw AppError.unauthorized();
    }
    if (!allowed.includes(request.auth.role)) {
      throw AppError.forbidden(
        "You do not have permission to perform this action",
      );
    }
  };
}

/** Mutations (create/update/delete) require a write role; `viewer` is read-only. */
export const requireWrite: preHandlerHookHandler = requireRole(...WRITE_ROLES);

/**
 * Requires a logged-in **user session** (not merely any credential). Used by
 * the self-authenticating `/v1/auth/*` routes (logout, change-password,
 * profile), which the global hook skips — so this resolves the token itself.
 */
export const requireSession: preHandlerHookHandler = async (request) => {
  if (!request.auth) {
    await authenticateRequest(request);
  }
  if (request.auth?.actorType !== "user") {
    throw AppError.unauthorized("A user session is required");
  }
};
