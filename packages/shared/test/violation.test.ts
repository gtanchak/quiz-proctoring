import { describe, expect, it } from "vitest";
import {
  VIOLATION_SCHEMA_VERSION,
  VIOLATION_TYPES,
  isViolationEvent,
  validateViolationEvent,
  validateViolationEventBatch,
} from "../src/index.js";

const ID = "11111111-1111-1111-1111-111111111111";
const ATTEMPT = "22222222-2222-2222-2222-222222222222";

const valid = {
  id: ID,
  attemptId: ATTEMPT,
  type: "tab_switch",
  severity: "medium",
  startedAt: "2026-06-01T12:00:00.000Z",
};

describe("validateViolationEvent", () => {
  it("accepts a valid event and fills defaults", () => {
    const result = validateViolationEvent(valid);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.schemaVersion).toBe(VIOLATION_SCHEMA_VERSION);
      expect(result.value.evidenceIds).toEqual([]);
    }
  });

  it("accepts every known violation type", () => {
    for (const type of VIOLATION_TYPES) {
      expect(validateViolationEvent({ ...valid, type }).valid).toBe(true);
    }
  });

  it("rejects an unknown violation type", () => {
    const result = validateViolationEvent({ ...valid, type: "telepathy" });
    expect(result.valid).toBe(false);
  });

  it("rejects a non-uuid attemptId", () => {
    expect(validateViolationEvent({ ...valid, attemptId: "nope" }).valid).toBe(
      false,
    );
  });

  it("rejects an unknown severity", () => {
    expect(validateViolationEvent({ ...valid, severity: "critical" }).valid).toBe(
      false,
    );
  });

  it("rejects unknown top-level properties", () => {
    const result = validateViolationEvent({ ...valid, foo: "bar" });
    expect(result.valid).toBe(false);
  });

  it("accepts ranged events with end/duration/metadata/evidence", () => {
    const result = validateViolationEvent({
      ...valid,
      type: "window_blur",
      endedAt: "2026-06-01T12:00:05.000Z",
      durationMs: 5000,
      evidenceIds: ["ev_1", "ev_2"],
      metadata: { hiddenMs: 5000 },
    });
    expect(result.valid).toBe(true);
  });

  it("reports readable errors with field paths", () => {
    const result = validateViolationEvent({ ...valid, attemptId: 123 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.join("\n")).toMatch(/attemptId/);
    }
  });
});

describe("isViolationEvent", () => {
  it("narrows a valid event", () => {
    expect(isViolationEvent({ ...valid, schemaVersion: 1 })).toBe(true);
    expect(isViolationEvent({ ...valid, type: "telepathy" })).toBe(false);
  });
});

describe("validateViolationEventBatch", () => {
  it("accepts a non-empty batch", () => {
    const result = validateViolationEventBatch({
      attemptId: ATTEMPT,
      events: [valid, { ...valid, id: "33333333-3333-3333-3333-333333333333" }],
    });
    expect(result.valid).toBe(true);
  });

  it("rejects an empty batch", () => {
    expect(
      validateViolationEventBatch({ attemptId: ATTEMPT, events: [] }).valid,
    ).toBe(false);
  });

  it("rejects a batch containing an invalid event", () => {
    expect(
      validateViolationEventBatch({
        attemptId: ATTEMPT,
        events: [{ ...valid, type: "telepathy" }],
      }).valid,
    ).toBe(false);
  });
});
