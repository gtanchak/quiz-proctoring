import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { AppError } from "../lib/errors.js";

/**
 * Resolves and enforces the tenant boundary (PRO-57, FR-38). Runs after
 * {@link AuthGuard}: when a request has been authenticated, it must carry a
 * tenant (org) id — every tenant-owned query is then scoped by it, so data
 * never crosses tenants. Routes with no auth (the candidate `/v1/public/*`
 * surface, the open `/v1/auth/*` endpoints) carry no tenant and are skipped.
 *
 * This is the structural application-layer guarantee; DB-level row-level
 * security as defence-in-depth is a planned follow-up (see ADR 0002).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.auth) {
      if (!req.auth.orgId) {
        // An authenticated actor with no tenant is a server-side invariant
        // violation, never a client error.
        throw new AppError(500, "INTERNAL", "Authenticated actor has no tenant");
      }
      req.tenantId = req.auth.orgId;
    }
    return true;
  }
}
