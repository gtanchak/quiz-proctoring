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
 * Single exception filter producing the shared machine-readable envelope —
 * the NestJS equivalent of the old Fastify `setErrorHandler`/`setNotFoundHandler`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("ExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();

    if (exception instanceof AppError) {
      res
        .status(exception.statusCode)
        .json(envelope(exception.code, exception.message, exception.details));
      return;
    }

    if (exception instanceof ThrottlerException) {
      res
        .status(429)
        .json(envelope(ErrorCode.RATE_LIMITED, exception.message));
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

    this.logger.error(exception);
    res.status(500).json(envelope(ErrorCode.INTERNAL, "Internal Server Error"));
  }
}
