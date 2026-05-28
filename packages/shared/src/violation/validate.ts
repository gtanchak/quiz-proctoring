import { type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
// Side-effect import: registers the `uuid` / `date-time` formats so Value.Check
// enforces them (TypeBox does not validate formats unless registered).
import "./formats.js";
import {
  ViolationEventBatchSchema,
  ViolationEventSchema,
  type ViolationEvent,
  type ViolationEventBatch,
} from "./types.js";

export interface ValidationSuccess<T> {
  valid: true;
  value: T;
}
export interface ValidationFailure {
  valid: false;
  errors: string[];
}
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/**
 * Validates `input` against a schema after applying defaults (so e.g. an
 * omitted `schemaVersion` is filled in). Runs identically in the browser (the
 * SDK, before sending) and on the server (the ingestion service, on receipt) —
 * one definition, one behaviour.
 */
function validate<T>(schema: TSchema, input: unknown): ValidationResult<T> {
  const value = Value.Default(schema, input) as unknown;
  if (Value.Check(schema, value)) {
    return { valid: true, value: value as T };
  }
  const errors = [...Value.Errors(schema, value)].map(
    (e) => `${e.path || "(root)"}: ${e.message}`,
  );
  return { valid: false, errors };
}

export function validateViolationEvent(
  input: unknown,
): ValidationResult<ViolationEvent> {
  return validate<ViolationEvent>(ViolationEventSchema, input);
}

export function validateViolationEventBatch(
  input: unknown,
): ValidationResult<ViolationEventBatch> {
  return validate<ViolationEventBatch>(ViolationEventBatchSchema, input);
}

/** Convenience boolean guard for callers that only need yes/no. */
export function isViolationEvent(input: unknown): input is ViolationEvent {
  return Value.Check(ViolationEventSchema, input);
}
