import { Value } from "@sinclair/typebox/value";
// Side-effect import: registers the `uuid` / `date-time` formats so Value.Check
// enforces them (TypeBox does not validate formats unless registered).
import "../violation/formats.js";
import type { ValidationResult } from "../violation/validate.js";
import { AttemptReportSchema, type AttemptReport } from "./types.js";

/**
 * Validates an attempt report after applying defaults. Useful on the consumer
 * side (admin-web) to fail loudly on a malformed payload; core-api validates the
 * same schema natively on the way out via Fastify.
 */
export function validateAttemptReport(
  input: unknown,
): ValidationResult<AttemptReport> {
  const value = Value.Default(AttemptReportSchema, input) as unknown;
  if (Value.Check(AttemptReportSchema, value)) {
    return { valid: true, value: value as AttemptReport };
  }
  const errors = [...Value.Errors(AttemptReportSchema, value)].map(
    (e) => `${e.path || "(root)"}: ${e.message}`,
  );
  return { valid: false, errors };
}
