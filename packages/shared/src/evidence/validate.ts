import { type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
// Side-effect import: registers the `uuid` / `date-time` formats so Value.Check
// enforces them (TypeBox does not validate formats unless registered).
import "../violation/formats.js";
import {
  AttemptEvidenceSchema,
  EvidenceUploadGrantSchema,
  SnapshotCaptureConfigSchema,
  SnapshotMetadataSchema,
  type AttemptEvidence,
  type EvidenceUploadGrant,
  type SnapshotCaptureConfig,
  type SnapshotMetadata,
} from "./types.js";

// ValidationResult and friends are re-exported by the violation module already;
// we only need the type here.
import type { ValidationResult } from "../violation/validate.js";

/**
 * Validates `input` against a schema after applying defaults — so an admin
 * config that omits, say, `jitterRatio` is filled from the schema default. Runs
 * the same on both sides of the boundary.
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

export function validateSnapshotCaptureConfig(
  input: unknown,
): ValidationResult<SnapshotCaptureConfig> {
  return validate<SnapshotCaptureConfig>(SnapshotCaptureConfigSchema, input);
}

export function validateSnapshotMetadata(
  input: unknown,
): ValidationResult<SnapshotMetadata> {
  return validate<SnapshotMetadata>(SnapshotMetadataSchema, input);
}

/** Validates an upload grant (PRO-27) — used by the host wiring the SDK uploader. */
export function validateEvidenceUploadGrant(
  input: unknown,
): ValidationResult<EvidenceUploadGrant> {
  return validate<EvidenceUploadGrant>(EvidenceUploadGrantSchema, input);
}

/** Validates an attempt's evidence list (PRO-27) — used by the admin report viewer. */
export function validateAttemptEvidence(
  input: unknown,
): ValidationResult<AttemptEvidence> {
  return validate<AttemptEvidence>(AttemptEvidenceSchema, input);
}
