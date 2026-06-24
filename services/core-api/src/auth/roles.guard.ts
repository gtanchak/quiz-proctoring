import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@proctoring/shared";
import type { Request } from "express";
import { AppError } from "../lib/errors.js";
import { ROLES_KEY } from "./roles.decorator.js";

/**
 * Enforces `@Roles(...)`/`@RequireWrite()` metadata against `request.auth.role`
 * (populated by {@link AuthGuard}). Method metadata wins over controller-level.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!allowed) {
      return true;
    }
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.auth) {
      throw AppError.unauthorized();
    }
    if (!allowed.includes(req.auth.role)) {
      throw AppError.forbidden(
        "You do not have permission to perform this action",
      );
    }
    return true;
  }
}
