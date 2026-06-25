import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { Type } from "@sinclair/typebox";
import {
  ATTEMPT_REPORT_SCHEMA_VERSION,
  type AttemptEvaluation,
  type AttemptReport,
  type AttemptReportSummary,
  type AttemptTerminationReason,
  type CompetencyScore,
  type RecommendationBand,
  RecommendationBandSchema,
  type ReportViolation,
  aggregateCompetencies,
} from "@proctoring/shared";
import { and, eq } from "drizzle-orm";
import { Auth } from "../auth/auth.decorator.js";
import type { RequestAuth } from "../auth/request-auth.js";
import { RequireWrite } from "../auth/roles.decorator.js";
import { TenantId } from "../auth/tenant.decorator.js";
import { db } from "../db/client.js";
import {
  type AttemptRow,
  attempts,
  type QuestionRow,
  questions,
  type ResponseRow,
  responses,
  tests,
} from "../db/schema/tests.js";
import { AuditAction, recordAudit } from "../lib/audit.js";
import { AppError } from "../lib/errors.js";
import { validate } from "../lib/validate.js";
import {
  getViolationsClient,
  type IngestedViolation,
} from "../lib/violations-client.js";

const IdParams = Type.Object({ id: Type.String({ format: "uuid" }) });
const OverrideBody = Type.Object(
  {
    band: RecommendationBandSchema,
    note: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  },
  { additionalProperties: false },
);

interface ReportTest {
  id: string;
  title: string;
  durationMinutes: number | null;
}

/**
 * The per-attempt report (PRO-26). core-api is the BFF: it owner-scopes the
 * attempt + test from its own store, then fetches the violation timeline from
 * the isolated violation-ingest service and assembles the report.
 *
 * Access control: the URL is the attempt's unguessable UUID, and the query is
 * scoped to the caller's org — a non-owner gets 404 (never leaking existence).
 */
@Controller("v1")
export class ReportsController {
  @Get("attempts/:id/report")
  async report(
    @TenantId() tenantId: string,
    @Param() params: Record<string, string>,
  ): Promise<AttemptReport> {
    const { id } = validate(IdParams, params);
    const { attempt, test } = await loadOwnedAttempt(id, tenantId);
    const [violations, qs, rs] = await Promise.all([
      getViolationsClient().listForAttempt(attempt.id),
      db.select().from(questions).where(eq(questions.testId, attempt.testId)),
      db.select().from(responses).where(eq(responses.attemptId, attempt.id)),
    ]);
    const report = buildReport(attempt, test, violations);
    report.evaluation = buildEvaluation(attempt, qs, rs);
    return report;
  }

  /**
   * Record a recruiter's manual override of the recommendation band (PRO-60,
   * FR-28/FR-30) — the human-in-the-loop hook. Audited; advisory, never a
   * verdict. Returns the recomputed evaluation reflecting the override.
   */
  @Patch("attempts/:id/recommendation")
  @RequireWrite()
  async overrideRecommendation(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
    @Body() body: unknown,
  ): Promise<AttemptEvaluation> {
    const { id } = validate(IdParams, params);
    const dto = validate(OverrideBody, body);
    const { attempt } = await loadOwnedAttempt(id, auth.orgId);
    const [updated] = await db
      .update(attempts)
      .set({
        recommendationOverride: dto.band,
        recommendationNote: dto.note ?? null,
      })
      .where(eq(attempts.id, attempt.id))
      .returning();
    recordAudit({
      orgId: auth.orgId,
      actorType: auth.actorType,
      actorUserId: auth.userId,
      action: AuditAction.RECOMMENDATION_OVERRIDDEN,
      targetType: "attempt",
      targetId: attempt.id,
      metadata: { band: dto.band },
    });
    const [qs, rs] = await Promise.all([
      db.select().from(questions).where(eq(questions.testId, updated.testId)),
      db.select().from(responses).where(eq(responses.attemptId, updated.id)),
    ]);
    return buildEvaluation(updated, qs, rs);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Competency-aggregated evaluation for an attempt (PRO-60). Groups graded
 * questions by competency (untagged → "general"), weights each competency by
 * its points, and applies any human override of the band. MCQ is deterministic,
 * so confidence is 1.
 */
function buildEvaluation(
  attempt: AttemptRow,
  qs: QuestionRow[],
  rs: ResponseRow[],
): AttemptEvaluation {
  const awardedByQ = new Map(rs.map((r) => [r.questionId, r.awardedPoints ?? 0]));
  const buckets = new Map<string, { score: number; max: number }>();
  for (const q of qs) {
    const key = q.competency ?? "general";
    const b = buckets.get(key) ?? { score: 0, max: 0 };
    b.max += q.points;
    b.score += awardedByQ.get(q.id) ?? 0;
    buckets.set(key, b);
  }
  const competencies: CompetencyScore[] = [...buckets].map(([key, b]) => ({
    key,
    score: round2(b.score),
    maxScore: b.max,
    // Default weighting is points-proportional (percent == overall raw percent);
    // per-competency weight config is a later refinement.
    weight: b.max,
    confidence: 1,
  }));
  const agg = aggregateCompetencies(competencies);
  const override: AttemptEvaluation["override"] = attempt.recommendationOverride
    ? {
        band: attempt.recommendationOverride as RecommendationBand,
        note: attempt.recommendationNote ?? null,
      }
    : null;
  return { ...agg, override };
}

/** Loads an attempt and its test, scoped to the org, or throws 404. */
async function loadOwnedAttempt(
  id: string,
  orgId: string,
): Promise<{ attempt: AttemptRow; test: ReportTest }> {
  const [row] = await db
    .select({
      attempt: attempts,
      testId: tests.id,
      testTitle: tests.title,
      testDuration: tests.durationMinutes,
    })
    .from(attempts)
    .innerJoin(tests, eq(attempts.testId, tests.id))
    .where(and(eq(attempts.id, id), eq(tests.orgId, orgId)))
    .limit(1);
  if (!row) {
    throw AppError.notFound("Attempt not found");
  }
  return {
    attempt: row.attempt,
    test: {
      id: row.testId,
      title: row.testTitle,
      durationMinutes: row.testDuration,
    },
  };
}

/** Why a finished attempt ended, when it was not a clean candidate submit. */
function terminationReason(
  status: AttemptRow["status"],
): AttemptTerminationReason | null {
  if (status === "expired") return "deadline_reached";
  if (status === "abandoned") return "abandoned";
  return null;
}

function summarize(attempt: AttemptRow): AttemptReportSummary {
  const startedAt = attempt.startedAt;
  const submittedAt = attempt.submittedAt;
  const durationUsedMs =
    startedAt && submittedAt
      ? Math.max(0, submittedAt.getTime() - startedAt.getTime())
      : null;
  return {
    id: attempt.id,
    testId: attempt.testId,
    candidateEmail: attempt.candidateEmail,
    status: attempt.status,
    terminationReason: terminationReason(attempt.status),
    startedAt: startedAt?.toISOString() ?? null,
    submittedAt: submittedAt?.toISOString() ?? null,
    deadlineAt: attempt.deadlineAt?.toISOString() ?? null,
    durationUsedMs,
    score: attempt.score,
    maxScore: attempt.maxScore,
    createdAt: attempt.createdAt.toISOString(),
  };
}

function buildReport(
  attempt: AttemptRow,
  test: ReportTest,
  violations: IngestedViolation[],
): AttemptReport {
  const startMs = attempt.startedAt?.getTime() ?? null;
  // Defensive sort: the read API already returns ascending start order, but a
  // report must be reliably chronological even if pagination ever reorders.
  const ordered = [...violations].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
  );
  const timeline: ReportViolation[] = ordered.map((v) => ({
    id: v.id,
    type: v.type,
    severity: v.severity,
    startedAt: v.startedAt,
    endedAt: v.endedAt,
    durationMs: v.durationMs,
    offsetMs:
      startMs === null ? 0 : Math.max(0, Date.parse(v.startedAt) - startMs),
    evidenceIds: v.evidenceIds,
    metadata: v.metadata,
  }));

  return {
    schemaVersion: ATTEMPT_REPORT_SCHEMA_VERSION,
    attempt: summarize(attempt),
    test,
    timeline,
    violationCount: timeline.length,
    generatedAt: new Date().toISOString(),
  };
}
