import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { AppError } from "../lib/errors.js";
import { authenticateToken } from "./authenticate.js";

/**
 * Requires a logged-in **user session** (not merely any credential). Applied to
 * the self-authenticating `/v1/auth/*` routes (logout, change-password,
 * profile), which {@link AuthGuard} skips — so this resolves the token itself.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.auth) {
      req.auth = await authenticateToken(req.headers.authorization);
    }
    if (req.auth?.actorType !== "user") {
      throw AppError.unauthorized("A user session is required");
    }
    return true;
  }
}
