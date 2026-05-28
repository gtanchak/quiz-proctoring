import type { FastifyError, FastifyInstance } from "fastify";
import { AppError, ErrorCode, type ErrorResponse } from "./errors.js";

function envelope(
  code: ErrorCode,
  message: string,
  details?: unknown,
): ErrorResponse {
  return { error: { code, message, ...(details !== undefined && { details }) } };
}

/** Single error + 404 handlers producing the shared machine-readable envelope. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation) {
      reply
        .status(400)
        .send(envelope(ErrorCode.VALIDATION, error.message, error.validation));
      return;
    }
    if (error instanceof AppError) {
      reply
        .status(error.statusCode)
        .send(envelope(error.code, error.message, error.details));
      return;
    }
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
    request.log.error(error);
    reply.status(500).send(envelope(ErrorCode.INTERNAL, "Internal Server Error"));
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
