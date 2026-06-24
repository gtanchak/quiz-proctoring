import { type ExecutionContext, createParamDecorator } from "@nestjs/common";
import type { Request } from "express";
import { AppError } from "../lib/errors.js";
import type { RequestAuth } from "./request-auth.js";

/**
 * Injects the authenticated identity ({@link RequestAuth}) populated by
 * {@link AuthGuard}/{@link SessionGuard}. Throws 401 if absent — a guard should
 * always have set it on guarded routes, so absence is a programming error.
 */
export const Auth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestAuth => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.auth) {
      throw AppError.unauthorized();
    }
    return req.auth;
  },
);
