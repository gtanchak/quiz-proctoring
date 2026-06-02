import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
  ATTEMPT_REPORT_SCHEMA_VERSION,
  AttemptReportSchema,
  type AttemptReport,
  type AttemptReportSummary,
  type AttemptTerminationReason,
  type ReportViolation,
} from "@proctoring/shared";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { type AttemptRow, attempts, tests } from "../../db/schema/tests.js";
import { AppError } from "../../lib/errors.js";
import {
  getViolationsClient,
  type IngestedViolation,
} from "../../lib/violations-client.js";

const IdParams = Type.Object({ id: Type.String({ format: "uuid" }) });

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
 * scoped to the caller's org — a non-owner gets 404 (never leaking existence),
 * satisfying "unguessable and scoped to the owner".
 */
export const reportsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/attempts/:id/report",
    {
      schema: {
        tags: ["reports"],
        summary: "Per-attempt report: summary + violation timeline",
        security: [{ bearerAuth: [] }],
        params: IdParams,
        response: {
          200: AttemptReportSchema,
          404: Type.Ref("ErrorResponse"),
          502: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      const { attempt, test } = await loadOwnedAttempt(
        request.params.id,
        request.auth!.orgId,
      );
      const violations = await getViolationsClient().listForAttempt(attempt.id);
      return buildReport(attempt, test, violations);
    },
  );
};

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
function terminationReason(status: AttemptRow["status"]): AttemptTerminationReason | null {
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
