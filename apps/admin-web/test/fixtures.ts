import type { AttemptReport, EvidenceItem } from "@proctoring/shared";

const ATTEMPT = "22222222-2222-2222-2222-222222222222";
const TEST = "33333333-3333-3333-3333-333333333333";

/** Evidence id linked to the first violation in {@link sampleReport}. */
export const LINKED_EVIDENCE_ID = "66666666-6666-6666-6666-666666666666";
const AUDIO_EVIDENCE_ID = "77777777-7777-7777-7777-777777777777";

/** A representative report: completed attempt, two violations. */
export function sampleReport(over: Partial<AttemptReport> = {}): AttemptReport {
  return {
    schemaVersion: 1,
    attempt: {
      id: ATTEMPT,
      testId: TEST,
      candidateEmail: "candidate@example.com",
      status: "submitted",
      terminationReason: null,
      startedAt: "2026-06-01T12:00:00.000Z",
      submittedAt: "2026-06-01T12:30:00.000Z",
      deadlineAt: "2026-06-01T13:00:00.000Z",
      durationUsedMs: 30 * 60_000,
      score: 7,
      maxScore: 10,
      createdAt: "2026-06-01T11:59:00.000Z",
    },
    test: { id: TEST, title: "Algebra I", durationMinutes: 60 },
    timeline: [
      {
        id: "44444444-4444-4444-4444-444444444444",
        type: "tab_switch",
        severity: "medium",
        startedAt: "2026-06-01T12:01:00.000Z",
        endedAt: "2026-06-01T12:01:04.000Z",
        durationMs: 4_000,
        offsetMs: 60_000,
        evidenceIds: [LINKED_EVIDENCE_ID],
        metadata: null,
      },
      {
        id: "55555555-5555-5555-5555-555555555555",
        type: "fullscreen_exit",
        severity: "high",
        startedAt: "2026-06-01T12:10:00.000Z",
        endedAt: null,
        durationMs: null,
        offsetMs: 600_000,
        evidenceIds: [],
        metadata: null,
      },
    ],
    violationCount: 2,
    generatedAt: "2026-06-01T12:31:00.000Z",
    ...over,
  };
}

/** Representative evidence: a webcam snapshot (linked to violation 1) + an audio clip. */
export function sampleEvidence(): EvidenceItem[] {
  return [
    {
      id: LINKED_EVIDENCE_ID,
      attemptId: ATTEMPT,
      kind: "webcam",
      contentType: "image/jpeg",
      byteSize: 24_000,
      width: 640,
      height: 480,
      capturedAt: "2026-06-01T12:01:00.000Z",
      url: "https://evidence.example/signed/webcam.jpg?sig=abc",
      expiresAt: "2026-06-01T12:36:00.000Z",
    },
    {
      id: AUDIO_EVIDENCE_ID,
      attemptId: ATTEMPT,
      kind: "webcam",
      contentType: "audio/webm",
      byteSize: 8_000,
      width: null,
      height: null,
      capturedAt: "2026-06-01T12:05:00.000Z",
      url: "https://evidence.example/signed/clip.webm?sig=def",
      expiresAt: "2026-06-01T12:36:00.000Z",
    },
  ];
}
