import type { FastifyError, FastifyInstance } from "fastify";
import { AppError, ErrorCode, type ErrorResponse } from "./errors.js";

function envelope(
  code: ErrorCode,
  message: string,
  details?: unknown,
): ErrorResponse {
  return { error: { code, message, ...(details !== undefined && { details }) } };
}

/**
 * Wires the single error + 404 handlers so every failure leaves core-api in the
 * same machine-readable envelope, regardless of where it originated (schema
 * validation, thrown AppError, plugin errors like rate limiting, or a bug).
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    // Fastify schema (TypeBox/Ajv) validation failures.
    if (error.validation) {
      reply
        .status(400)
        .send(envelope(ErrorCode.VALIDATION, error.message, error.validation));
      return;
    }

    // Errors we raised deliberately.
    if (error instanceof AppError) {
      reply
        .status(error.statusCode)
        .send(envelope(error.code, error.message, error.details));
      return;
    }

    // Rate limiting (@fastify/rate-limit) and other 4xx from plugins.
    if (error.statusCode === 429) {
      reply.status(429).send(envelope(ErrorCode.RATE_LIMITED, error.message));
      return;
    }
    if (typeof error.statusCode === "number" && error.statusCode < 500) {
      reply
        .status(error.statusCode)
        .send(envelope(ErrorCode.BAD_REQUEST, error.message));
      return;
    }

    // Anything else is a bug — log it, but never leak internals to the client.
    request.log.error(error);
    reply
      .status(500)
      .send(envelope(ErrorCode.INTERNAL, "Internal Server Error"));
  });

  app.setNotFoundHandler((request, reply) => {
    reply
      .status(404)
      .send(
        envelope(
          ErrorCode.NOT_FOUND,
          `Route ${request.method} ${request.url} not found`,
        ),
      );
  });
}
