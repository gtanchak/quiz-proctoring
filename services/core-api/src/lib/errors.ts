import { Type, type Static } from "@sinclair/typebox";

/**
 * Machine-readable error codes (CLAUDE.md §8: consistent, machine-readable
 * error shapes). Keep these stable — API consumers branch on them.
 */
export const ErrorCode = {
  VALIDATION: "VALIDATION",
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** The single error envelope every non-2xx response uses. */
export const ErrorResponse = Type.Object(
  {
    error: Type.Object({
      code: Type.String({ description: "Stable machine-readable error code" }),
      message: Type.String(),
      details: Type.Optional(Type.Unknown()),
    }),
  },
  { $id: "ErrorResponse" },
);

export type ErrorResponse = Static<typeof ErrorResponse>;

/**
 * Application error carrying an HTTP status and a stable code. Throw these from
 * handlers; the central error handler renders them into the ErrorResponse shape.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(400, ErrorCode.BAD_REQUEST, message, details);
  }

  static unauthorized(message = "Authentication required"): AppError {
    return new AppError(401, ErrorCode.UNAUTHORIZED, message);
  }

  static forbidden(message = "Forbidden"): AppError {
    return new AppError(403, ErrorCode.FORBIDDEN, message);
  }

  static notFound(message = "Resource not found"): AppError {
    return new AppError(404, ErrorCode.NOT_FOUND, message);
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError(409, ErrorCode.CONFLICT, message, details);
  }
}
