import {
  validateViolationEvent,
  VIOLATION_SCHEMA_VERSION,
  type ViolationEvent,
  type ViolationSeverity,
  type ViolationType,
} from "@proctoring/shared";

/**
 * Client-side violation handling for detectors. The SDK builds events and
 * validates them against the **shared** schema before queuing/sending — the
 * exact same definition the ingestion service validates against on receipt, so
 * a client can never emit a shape the server will reject.
 *
 * This is the PRO-50 wiring; the detectors themselves (PRO-16+) call
 * `createViolationEvent` and hand the result to the (future) upload queue.
 */

export type {
  ViolationEvent,
  ViolationType,
  ViolationSeverity,
} from "@proctoring/shared";

export interface NewViolationInput {
  attemptId: string;
  type: ViolationType;
  severity: ViolationSeverity;
  startedAt?: Date;
  endedAt?: Date | null;
  evidenceIds?: string[];
  metadata?: Record<string, unknown>;
}

/** Builds a schema-valid violation event, assigning id/version/timestamp. */
export function createViolationEvent(input: NewViolationInput): ViolationEvent {
  const startedAt = input.startedAt ?? new Date();
  const event = {
    schemaVersion: VIOLATION_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    attemptId: input.attemptId,
    type: input.type,
    severity: input.severity,
    startedAt: startedAt.toISOString(),
    endedAt: input.endedAt ? input.endedAt.toISOString() : undefined,
    evidenceIds: input.evidenceIds,
    metadata: input.metadata,
  };
  const result = validateViolationEvent(event);
  if (!result.valid) {
    throw new Error(`Invalid violation event: ${result.errors.join("; ")}`);
  }
  return result.value;
}

/** Guard used before queuing an event for upload. */
export function isSendableViolation(event: unknown): event is ViolationEvent {
  return validateViolationEvent(event).valid;
}
