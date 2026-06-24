import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";

/**
 * Per-actor rate limiting. Keyed by the authenticated user id or API key id
 * when present (set by {@link AuthGuard}, which runs first), falling back to
 * client IP for unauthenticated routes (login, the candidate surface). Limit
 * state is surfaced via the standard `x-ratelimit-*` headers.
 */
@Injectable()
export class ActorThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    return req.auth?.userId ?? req.auth?.apiKeyId ?? req.ip ?? "unknown";
  }
}
