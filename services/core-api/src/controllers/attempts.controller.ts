import { Controller, Get, Body, HttpCode, Param, Post, Query } from "@nestjs/common";
import { Type } from "@sinclair/typebox";
import { and, count, desc, eq } from "drizzle-orm";
import { Auth } from "../auth/auth.decorator.js";
import type { RequestAuth } from "../auth/request-auth.js";
import { RequireWrite } from "../auth/roles.decorator.js";
import { db } from "../db/client.js";
import {
  attempts,
  type AttemptRow,
  responses,
  tests,
} from "../db/schema/tests.js";
import { AppError } from "../lib/errors.js";
import { gradeAttempt } from "../lib/grade-attempt.js";
import { PaginationQuery } from "../lib/pagination.js";
import { findOrgTest } from "../lib/test-access.js";
import { computeDeadline, timerState } from "../lib/timer.js";
import { validate } from "../lib/validate.js";

export function serializeAttempt(row: AttemptRow, now: Date = new Date()) {
  const timer = timerState(row, now);
  return {
    id: row.id,
    testId: row.testId,
    candidateEmail: row.candidateEmail,
    status: row.status,
    startedAt: row.startedAt?.toISOString() ?? null,
    deadlineAt: row.deadlineAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    remainingMs: timer.remainingMs,
    expired: timer.expired,
    score: row.score,
    maxScore: row.maxScore,
    createdAt: row.createdAt.toISOString(),
  };
}

const TestIdParams = Type.Object({ testId: Type.String({ format: "uuid" }) });
const IdParams = Type.Object({ id: Type.String({ format: "uuid" }) });
const StartBody = Type.Object({
  candidateEmail: Type.Optional(Type.String({ format: "email" })),
});

/**
 * Attempt lifecycle and the server-authoritative timer.
 *
 * The timer is enforced entirely server-side: `deadline_at` is set from the
 * server clock at start, remaining time is computed from the server clock on
 * every read, and an attempt past its deadline is auto-submitted and locked the
 * next time it is touched (lazy expiry). A background sweep is a V1 refinement.
 */
@Controller("v1")
export class AttemptsController {
  @Post("tests/:testId/attempts")
  @RequireWrite()
  @HttpCode(201)
  async start(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
    @Body() body: unknown,
  ) {
    const { testId } = validate(TestIdParams, params);
    const dto = validate(StartBody, body);
    const test = await findOrgTest(testId, auth.orgId);
    if (test.status !== "published") {
      throw AppError.conflict("Test must be published to start an attempt");
    }
    const now = new Date();
    const [row] = await db
      .insert(attempts)
      .values({
        testId: test.id,
        candidateEmail: dto.candidateEmail,
        status: "in_progress",
        startedAt: now,
        deadlineAt: computeDeadline(now, test.durationMinutes),
      })
      .returning();
    return serializeAttempt(row, now);
  }

  @Get("tests/:testId/attempts")
  async list(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
    @Query() query: Record<string, unknown>,
  ) {
    const { testId } = validate(TestIdParams, params);
    const { limit, offset } = validate(PaginationQuery, query);
    await findOrgTest(testId, auth.orgId);
    const where = eq(attempts.testId, testId);

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(attempts)
        .where(where)
        .orderBy(desc(attempts.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(attempts).where(where),
    ]);

    return {
      data: rows.map((r) => serializeAttempt(r)),
      pagination: { total, limit, offset },
    };
  }

  @Get("attempts/:id")
  async get(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
  ) {
    const { id } = validate(IdParams, params);
    const row = await findOrgAttempt(id, auth.orgId);
    return serializeAttempt(await autoExpireIfDue(row));
  }

  @Post("attempts/:id/submit")
  @RequireWrite()
  @HttpCode(200)
  async submit(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
  ) {
    const { id } = validate(IdParams, params);
    const row = await findOrgAttempt(id, auth.orgId);
    return serializeAttempt(await finalizeAttempt(row));
  }

  @Get("attempts/:id/responses")
  async responses(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
  ) {
    const { id } = validate(IdParams, params);
    const attempt = await findOrgAttempt(id, auth.orgId);
    const rows = await db
      .select()
      .from(responses)
      .where(eq(responses.attemptId, attempt.id));
    return rows.map((r) => ({
      questionId: r.questionId,
      selectedOptionIds: r.selectedOptionIds,
      awardedPoints: r.awardedPoints,
    }));
  }
}

/**
 * Submits and locks an in-progress attempt. A submit past the deadline is
 * recorded as an expiry, not a clean submit. The WHERE re-checks status so a
 * concurrent submit/expiry can't double-finalize. Shared by the admin and
 * candidate (public) submit routes.
 */
export async function finalizeAttempt(row: AttemptRow): Promise<AttemptRow> {
  if (row.status !== "in_progress") {
    throw AppError.conflict("Attempt is already finalized");
  }
  const now = new Date();
  const finalStatus =
    row.deadlineAt && now.getTime() >= row.deadlineAt.getTime()
      ? "expired"
      : "submitted";
  const [updated] = await db
    .update(attempts)
    .set({ status: finalStatus, submittedAt: now })
    .where(and(eq(attempts.id, row.id), eq(attempts.status, "in_progress")))
    .returning();
  if (!updated) {
    throw AppError.conflict("Attempt is already finalized");
  }
  return gradeAttempt(updated);
}

/** Loads an attempt whose test belongs to the given org, or throws 404. */
async function findOrgAttempt(id: string, orgId: string): Promise<AttemptRow> {
  const [row] = await db
    .select({ attempt: attempts })
    .from(attempts)
    .innerJoin(tests, eq(attempts.testId, tests.id))
    .where(and(eq(attempts.id, id), eq(tests.orgId, orgId)))
    .limit(1);
  if (!row) {
    throw AppError.notFound("Attempt not found");
  }
  return row.attempt;
}

/**
 * If an in-progress attempt is past its deadline, finalize it as expired and
 * locked. Idempotent and race-safe (the WHERE re-checks status). Returns the
 * (possibly updated) row.
 */
export async function autoExpireIfDue(row: AttemptRow): Promise<AttemptRow> {
  if (row.status !== "in_progress" || !row.deadlineAt) {
    return row;
  }
  if (Date.now() < row.deadlineAt.getTime()) {
    return row;
  }
  const [updated] = await db
    .update(attempts)
    .set({ status: "expired", submittedAt: new Date() })
    .where(and(eq(attempts.id, row.id), eq(attempts.status, "in_progress")))
    .returning();
  // Grade what was saved before the deadline; if a concurrent finalize won the
  // race (no row updated), leave grading to that path.
  return updated ? await gradeAttempt(updated) : row;
}
