import { Type, type Static } from "@sinclair/typebox";

/** Machine-readable error codes (same envelope shape as core-api). */
export const ErrorCode = {
  VALIDATION: "VALIDATION",
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ErrorResponse = Type.Object(
  {
    error: Type.Object({
      code: Type.String(),
      message: Type.String(),
      details: Type.Optional(Type.Unknown()),
    }),
  },
  { $id: "ErrorResponse" },
);

export type ErrorResponse = Static<typeof ErrorResponse>;

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
}
