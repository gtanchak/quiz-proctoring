import { Type, type Static } from "@sinclair/typebox";
import {
  CompetencyScoreSchema,
  RecommendationBandSchema,
} from "../scoring/types.js";

/**
 * Per-attempt report contract (PRO-26): what an admin sees when reviewing one
 * candidate's attempt — a summary header, and a chronological violation
 * timeline assembled from the stored violation log (PRO-25).
 *
 * This is a cross-boundary shape (core-api produces it as a BFF, assembling
 * attempt/test data from its own store with the violation timeline fetched from
 * the isolated violation-ingest service; admin-web consumes it), so it is
 * defined once here (CLAUDE.md §4).
 *
 * Note: the report is **evidence for human review** — score and severities are
 * advisory, never a pass/fail verdict (CLAUDE.md §1). Evidence thumbnails for
 * each violation are wired in by the V1 evidence viewer (PRO-27); this contract
 * carries the `evidenceIds` so that wiring needs no schema change.
 */

/** Bump when the report shape changes. */
export const ATTEMPT_REPORT_SCHEMA_VERSION = 1 as const;

/**
 * Why a finished attempt ended, when it was not a clean candidate submit:
 * - `deadline_reached` — the server-authoritative timer expired (auto-submit).
 * - `abandoned` — the candidate left and never submitted.
 * `null` for a clean submit or an attempt still in progress.
 */
export const ATTEMPT_TERMINATION_REASONS = [
  "deadline_reached",
  "abandoned",
] as const;
export type AttemptTerminationReason =
  (typeof ATTEMPT_TERMINATION_REASONS)[number];

const TerminationReasonSchema = Type.Union(
  [
    ...ATTEMPT_TERMINATION_REASONS.map((r) => Type.Literal(r)),
    Type.Null(),
  ],
  { description: "Reason an attempt was auto-terminated; null for a clean end" },
);

/**
 * One violation on the timeline. `type`/`severity` are strings (not the closed
 * unions) so the report tolerates violation types added after this build — the
 * stored log keeps them as text for exactly this reason (PRO-25).
 */
export const ReportViolationSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    type: Type.String(),
    severity: Type.String(),
    /** Client-observed start (ISO 8601). */
    startedAt: Type.String({ format: "date-time" }),
    /** Client-observed end for ranged violations; null if instantaneous. */
    endedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    durationMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    /**
     * Milliseconds from the attempt's start to this violation — the timeline's
     * x-axis. Clamped to ≥ 0 (client clock skew can put an event slightly before
     * the server start time).
     */
    offsetMs: Type.Integer({ minimum: 0 }),
    /** Ids of captured evidence (PRO-15); rendered by the V1 evidence viewer. */
    evidenceIds: Type.Array(Type.String()),
    metadata: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  },
  { $id: "ReportViolation", additionalProperties: false },
);
export type ReportViolation = Static<typeof ReportViolationSchema>;

/** The attempt summary header. */
export const AttemptReportSummarySchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    testId: Type.String({ format: "uuid" }),
    candidateEmail: Type.Union([Type.String(), Type.Null()]),
    status: Type.Union([
      Type.Literal("in_progress"),
      Type.Literal("submitted"),
      Type.Literal("expired"),
      Type.Literal("abandoned"),
    ]),
    terminationReason: TerminationReasonSchema,
    startedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    submittedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    deadlineAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    /** Wall-clock time the candidate used (start → submit), in ms; null if not started. */
    durationUsedMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    /** Final score once graded (PRO-53); null until then. */
    score: Type.Union([Type.Number(), Type.Null()]),
    maxScore: Type.Union([Type.Number(), Type.Null()]),
    createdAt: Type.String({ format: "date-time" }),
  },
  { $id: "AttemptReportSummary", additionalProperties: false },
);
export type AttemptReportSummary = Static<typeof AttemptReportSummarySchema>;

/** Minimal test context shown on the report. */
export const ReportTestInfoSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    title: Type.String(),
    durationMinutes: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  },
  { $id: "ReportTestInfo", additionalProperties: false },
);
export type ReportTestInfo = Static<typeof ReportTestInfoSchema>;

/**
 * The evaluation block (PRO-60): competency-aggregated score, the advisory
 * recommendation band, and a confidence/low-confidence signal — plus any human
 * override. The band is **never a verdict**; a reviewer always decides (FR-28).
 */
export const AttemptEvaluationSchema = Type.Object(
  {
    score: Type.Number(),
    maxScore: Type.Number(),
    percent: Type.Number({ minimum: 0, maximum: 100 }),
    /** Advisory band derived from `percent` (overridable by a human). */
    band: RecommendationBandSchema,
    competencies: Type.Array(CompetencyScoreSchema),
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
    lowConfidence: Type.Boolean(),
    /** A recruiter's manual override of the band, audited; null when none. */
    override: Type.Union([
      Type.Object(
        {
          band: RecommendationBandSchema,
          note: Type.Union([Type.String(), Type.Null()]),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
  { $id: "AttemptEvaluation", additionalProperties: false },
);
export type AttemptEvaluation = Static<typeof AttemptEvaluationSchema>;

/** The full per-attempt report. */
export const AttemptReportSchema = Type.Object(
  {
    schemaVersion: Type.Integer({
      minimum: 1,
      default: ATTEMPT_REPORT_SCHEMA_VERSION,
    }),
    attempt: AttemptReportSummarySchema,
    test: ReportTestInfoSchema,
    /** Violations in chronological order (ascending startedAt). */
    timeline: Type.Array(ReportViolationSchema),
    violationCount: Type.Integer({ minimum: 0 }),
    /** Competency scores, band, and confidence (PRO-60). Optional: present for
     * scored assessment types (MCQ today). */
    evaluation: Type.Optional(AttemptEvaluationSchema),
    /** When the report was assembled (server time). */
    generatedAt: Type.String({ format: "date-time" }),
  },
  { $id: "AttemptReport", additionalProperties: false },
);
export type AttemptReport = Static<typeof AttemptReportSchema>;
