import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { authenticateToken } from "./authenticate.js";

/**
 * Global authentication. Every `/v1` route requires a valid Bearer token —
 * either a session token (`sess_…`) or an API key (`proct_…`) — except:
 * - `/v1/public/*`: the candidate surface, which authenticates candidates itself;
 * - `/v1/auth/*`: sign-up/login/etc., which are open or self-authenticate
 *   (see {@link SessionGuard}).
 * Runs first (registered before the throttler guard) so backpressure can key
 * off the authenticated identity.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const path = req.path;
    const isV1 = path === "/v1" || path.startsWith("/v1/");
    const isPublic = path === "/v1/public" || path.startsWith("/v1/public/");
    const isAuth = path === "/v1/auth" || path.startsWith("/v1/auth/");
    if (isV1 && !isPublic && !isAuth) {
      req.auth = await authenticateToken(req.headers.authorization);
    }
    return true;
  }
}
