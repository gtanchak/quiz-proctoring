import { type ExecutionContext, createParamDecorator } from "@nestjs/common";
import type { Request } from "express";
import { AppError } from "../lib/errors.js";

/**
 * Injects the resolved tenant id (org id) for a tenant-scoped `/v1` handler,
 * set by {@link TenantGuard}. Use this instead of reading `auth.orgId` directly
 * so the tenant boundary is explicit at every query site (PRO-57). Throws 401
 * if no tenant is resolved — a guard should always have set it on these routes.
 */
export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const tenantId = req.tenantId ?? req.auth?.orgId;
    if (!tenantId) {
      throw AppError.unauthorized();
    }
    return tenantId;
  },
);
