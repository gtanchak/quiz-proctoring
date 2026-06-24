import { type TSchema, type Static } from "@sinclair/typebox";
import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { AppError, ErrorCode } from "./errors.js";

/**
 * Standalone replacement for Fastify's native (Ajv) schema validation. The same
 * TypeBox route schemas now validate here: we register the `format`s the routes
 * use (Ajv had these built in; TypeBox's `Value.Check` consults FormatRegistry),
 * apply defaults, coerce string inputs (query/params) to their schema types,
 * then check — throwing the shared VALIDATION envelope on failure.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Pragmatic email check (matches Ajv's "email" format closely enough for our use).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

FormatRegistry.Set("uuid", (v) => UUID_RE.test(v));
FormatRegistry.Set("email", (v) => EMAIL_RE.test(v));
FormatRegistry.Set("date-time", (v) => !Number.isNaN(Date.parse(v)));

/**
 * Validates+coerces `value` against `schema`. Returns the typed, defaulted,
 * coerced value, or throws `AppError(400, VALIDATION)` with the field errors.
 */
export function validate<T extends TSchema>(
  schema: T,
  value: unknown,
): Static<T> {
  // Match Fastify's Ajv pipeline: apply defaults, coerce string inputs, then
  // strip unknown properties (Fastify ran with `removeAdditional`) before check.
  let candidate = Value.Convert(schema, Value.Default(schema, value ?? {}));
  candidate = Value.Clean(schema, candidate);
  if (!Value.Check(schema, candidate)) {
    const errors = [...Value.Errors(schema, candidate)].map((e) => ({
      path: e.path,
      message: e.message,
    }));
    throw new AppError(
      400,
      ErrorCode.VALIDATION,
      "Request validation failed",
      errors,
    );
  }
  return candidate as Static<T>;
}
