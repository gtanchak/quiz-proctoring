import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify, { type FastifyInstance } from "fastify";
import { config } from "./config.js";
import { ErrorResponse } from "./lib/errors.js";
import { registerErrorHandling } from "./lib/error-handler.js";
import { authPlugin } from "./plugins/auth.js";
import { rateLimitPlugin } from "./plugins/rate-limit.js";
import { healthRoutes } from "./routes/health.js";
import { v1Routes } from "./routes/v1/index.js";

/**
 * Builds the core-api Fastify instance: TypeBox validation, the shared error
 * envelope, OpenAPI docs, and route registration. Returned without listening so
 * tests can drive it via `app.inject()`.
 *
 * Registration order matters: swagger before routes (so it can collect their
 * schemas), swagger-ui after.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { level: config.LOG_LEVEL },
  }).withTypeProvider<TypeBoxTypeProvider>();

  // Shared error envelope, registered once so routes can reference it by $id.
  app.addSchema(ErrorResponse);

  registerErrorHandling(app);

  app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Proctoring Core API",
        description:
          "Tests, attempts, users, and the public REST API. Authoritative for the test timer.",
        version: "0.0.0",
      },
      servers: [{ url: "/" }],
      tags: [
        { name: "system", description: "Health and operational endpoints" },
        { name: "auth", description: "Authentication and API keys" },
        { name: "tests", description: "Test authoring and management" },
        { name: "questions", description: "Question authoring (MCQ)" },
        { name: "attempts", description: "Candidate attempts (read)" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            description: "API key as `Authorization: Bearer <key>`",
          },
        },
      },
    },
  });

  // Auth must register before rate limiting so the authenticated identity is
  // available when the rate-limit hook computes its key.
  app.register(authPlugin);
  app.register(rateLimitPlugin);

  app.register(fastifySwaggerUi, { routePrefix: "/docs" });

  // Unversioned operational routes.
  app.register(healthRoutes);

  // Versioned API surface.
  app.register(v1Routes, { prefix: "/v1" });

  return app;
}
