import fastifyRateLimit from "@fastify/rate-limit";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify, { type FastifyInstance } from "fastify";
import { config } from "./config.js";
import { ErrorResponse } from "./lib/errors.js";
import { registerErrorHandling } from "./lib/error-handler.js";
import { violationRoutes } from "./routes/violations.js";

/**
 * Builds the violation-ingest Fastify app. Deliberately lean — this is the
 * write-heavy exam-day hot path, isolated from core-api so a flood of events
 * never slows test-taking.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { level: config.LOG_LEVEL },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.addSchema(ErrorResponse);
  registerErrorHandling(app);

  // Backpressure: cap requests per attempt token (falls back to IP).
  app.register(fastifyRateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
    keyGenerator: (request) => request.headers.authorization ?? request.ip,
  });

  app.get("/health", async () => ({ status: "ok", service: "violation-ingest" }));

  app.register(violationRoutes, { prefix: "/v1" });

  return app;
}
