import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { AppError, ErrorCode, type ErrorResponse } from "./errors.js";

function envelope(
  code: ErrorCode,
  message: string,
  details?: unknown,
): ErrorResponse {
  return { error: { code, message, ...(details !== undefined && { details }) } };
}

/**
 * Single exception filter so every failure leaves core-api in the same
 * machine-readable envelope, regardless of origin (validation, a thrown
 * AppError, rate limiting, an unmatched route, or a bug). The NestJS
 * equivalent of the old Fastify `setErrorHandler`/`setNotFoundHandler`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("ExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();

    // Errors we raised deliberately (includes VALIDATION from the validate()
    // helper, with field errors in `details`).
    if (exception instanceof AppError) {
      res
        .status(exception.statusCode)
        .json(envelope(exception.code, exception.message, exception.details));
      return;
    }

    if (exception instanceof ThrottlerException) {
      res.status(429).json(envelope(ErrorCode.RATE_LIMITED, exception.message));
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // Unmatched routes surface as 404 — keep the old envelope + message.
      if (status === 404) {
        res
          .status(404)
          .json(
            envelope(
              ErrorCode.NOT_FOUND,
              `Route ${req.method} ${req.originalUrl} not found`,
            ),
          );
        return;
      }
      if (status < 500) {
        res
          .status(status)
          .json(envelope(ErrorCode.BAD_REQUEST, exception.message));
        return;
      }
    }

    // Anything else is a bug — log it, but never leak internals to the client.
    this.logger.error(exception);
    res.status(500).json(envelope(ErrorCode.INTERNAL, "Internal Server Error"));
  }
}
