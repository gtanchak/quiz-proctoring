import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";

/**
 * Backpressure keyed by the attempt session token (falls back to IP) — the
 * same keying the old `@fastify/rate-limit` keyGenerator used, so one
 * candidate's flood cannot exhaust the budget for everyone on a shared IP.
 */
@Injectable()
export class AttemptThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    const authorization = req.headers?.authorization;
    return (
      (typeof authorization === "string" ? authorization : undefined) ??
      req.ip ??
      "unknown"
    );
  }
}
