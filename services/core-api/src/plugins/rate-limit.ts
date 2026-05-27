import fastifyRateLimit from "@fastify/rate-limit";
import fp from "fastify-plugin";
import { config } from "../config.js";

/**
 * Per-key rate limiting. Keyed by the authenticated API key id when present
 * (set by the auth plugin, which must be registered first so its onRequest hook
 * runs before this one), falling back to client IP for unauthenticated routes.
 * Limit state is communicated to clients via standard `x-ratelimit-*` headers.
 */
export const rateLimitPlugin = fp(
  async (app) => {
    await app.register(fastifyRateLimit, {
      max: config.RATE_LIMIT_MAX,
      timeWindow: config.RATE_LIMIT_WINDOW,
      keyGenerator: (request) => request.apiKey?.id ?? request.ip,
    });
  },
  { name: "rate-limit", dependencies: ["auth"] },
);
