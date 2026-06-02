import { describe, expect, it } from "vitest";
import {
  ATTEMPT_REPORT_SCHEMA_VERSION,
  validateAttemptReport,
} from "../src/index.js";

const ATTEMPT = "22222222-2222-2222-2222-222222222222";
const TEST = "33333333-3333-3333-3333-333333333333";
const VIOLATION = "44444444-4444-4444-4444-444444444444";

const validReport = {
  attempt: {
    id: ATTEMPT,
    testId: TEST,
    candidateEmail: "candidate@example.com",
    status: "expired",
    terminationReason: "deadline_reached",
    startedAt: "2026-06-01T12:00:00.000Z",
    submittedAt: "2026-06-01T12:30:00.000Z",
    deadlineAt: "2026-06-01T12:30:00.000Z",
    durationUsedMs: 1_800_000,
    score: 7,
    maxScore: 10,
    createdAt: "2026-06-01T11:59:00.000Z",
  },
  test: { id: TEST, title: "Algebra I", durationMinutes: 30 },
  timeline: [
    {
      id: VIOLATION,
      type: "tab_switch",
      severity: "medium",
      startedAt: "2026-06-01T12:05:00.000Z",
      endedAt: "2026-06-01T12:05:04.000Z",
      durationMs: 4_000,
      offsetMs: 300_000,
      evidenceIds: [],
      metadata: { durationMs: 4_000 },
    },
  ],
  violationCount: 1,
  generatedAt: "2026-06-01T12:31:00.000Z",
};

describe("validateAttemptReport", () => {
  it("accepts a valid report and fills the schema version", () => {
    const result = validateAttemptReport(validReport);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.schemaVersion).toBe(ATTEMPT_REPORT_SCHEMA_VERSION);
    }
  });

  it("accepts a clean submit with a null termination reason", () => {
    const report = {
      ...validReport,
      attempt: {
        ...validReport.attempt,
        status: "submitted",
        terminationReason: null,
      },
    };
    expect(validateAttemptReport(report).valid).toBe(true);
  });

  it("tolerates an unknown future violation type (stored as text)", () => {
    const report = {
      ...validReport,
      timeline: [{ ...validReport.timeline[0], type: "thermal_anomaly" }],
    };
    expect(validateAttemptReport(report).valid).toBe(true);
  });

  it("rejects an unknown attempt status", () => {
    const report = {
      ...validReport,
      attempt: { ...validReport.attempt, status: "paused" },
    };
    expect(validateAttemptReport(report).valid).toBe(false);
  });

  it("rejects a negative timeline offset", () => {
    const report = {
      ...validReport,
      timeline: [{ ...validReport.timeline[0], offsetMs: -1 }],
    };
    expect(validateAttemptReport(report).valid).toBe(false);
  });
});
