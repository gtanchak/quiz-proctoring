import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { attempts, tests, type AttemptRow } from "../../db/schema/tests.js";
import { AppError } from "../../lib/errors.js";
import { PaginationQuery, paginated } from "../../lib/pagination.js";
import { findOwnedTest } from "../../lib/test-access.js";
import { computeDeadline, timerState } from "../../lib/timer.js";

export const AttemptEntity = Type.Object(
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
    startedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    deadlineAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    submittedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    // Server-computed countdown — the candidate's source of truth for time left.
    remainingMs: Type.Union([Type.Integer(), Type.Null()]),
    expired: Type.Boolean(),
    createdAt: Type.String({ format: "date-time" }),
  },
  { $id: "Attempt" },
);

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
    createdAt: row.createdAt.toISOString(),
  };
}

const TestIdParams = Type.Object({ testId: Type.String({ format: "uuid" }) });
const IdParams = Type.Object({ id: Type.String({ format: "uuid" }) });

/**
 * Attempt lifecycle and the server-authoritative timer.
 *
 * The timer is enforced entirely server-side: `deadline_at` is set from the
 * server clock at start, remaining time is computed from the server clock on
 * every read, and an attempt past its deadline is auto-submitted and locked the
 * next time it is touched (lazy expiry). A background sweep is a V1 refinement.
 *
 * Routes are owner-scoped for now; candidate-facing access (links, invite,
 * session, max-attempts, resume) is PRO-8, and the countdown UI is candidate-web.
 */
export const attemptsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    "/tests/:testId/attempts",
    {
      schema: {
        tags: ["attempts"],
        summary: "Start an attempt (records the server-authoritative start time)",
        security: [{ bearerAuth: [] }],
        params: TestIdParams,
        body: Type.Object({
          candidateEmail: Type.Optional(Type.String({ format: "email" })),
        }),
        response: {
          201: AttemptEntity,
          404: Type.Ref("ErrorResponse"),
          409: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request, reply) => {
      const test = await findOwnedTest(request.params.testId, request.apiKey!.id);
      if (test.status !== "published") {
        throw AppError.conflict("Test must be published to start an attempt");
      }
      const now = new Date();
      const [row] = await db
        .insert(attempts)
        .values({
          testId: test.id,
          candidateEmail: request.body.candidateEmail,
          status: "in_progress",
          startedAt: now,
          deadlineAt: computeDeadline(now, test.durationMinutes),
        })
        .returning();
      reply.status(201);
      return serializeAttempt(row, now);
    },
  );

  app.get(
    "/tests/:testId/attempts",
    {
      schema: {
        tags: ["attempts"],
        summary: "List attempts for a test",
        security: [{ bearerAuth: [] }],
        params: TestIdParams,
        querystring: PaginationQuery,
        response: {
          200: paginated(AttemptEntity),
          404: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      await findOwnedTest(request.params.testId, request.apiKey!.id);
      const { limit, offset } = request.query;
      const where = eq(attempts.testId, request.params.testId);

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
    },
  );

  app.get(
    "/attempts/:id",
    {
      schema: {
        tags: ["attempts"],
        summary: "Get an attempt (auto-submits if its deadline has passed)",
        security: [{ bearerAuth: [] }],
        params: IdParams,
        response: { 200: AttemptEntity, 404: Type.Ref("ErrorResponse") },
      },
    },
    async (request) => {
      const row = await findOwnedAttempt(request.params.id, request.apiKey!.id);
      return serializeAttempt(await autoExpireIfDue(row));
    },
  );

  app.post(
    "/attempts/:id/submit",
    {
      schema: {
        tags: ["attempts"],
        summary: "Submit and lock an attempt",
        security: [{ bearerAuth: [] }],
        params: IdParams,
        response: {
          200: AttemptEntity,
          404: Type.Ref("ErrorResponse"),
          409: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      const row = await findOwnedAttempt(request.params.id, request.apiKey!.id);
      if (row.status !== "in_progress") {
        throw AppError.conflict("Attempt is already finalized");
      }
      const now = new Date();
      // A submit after the deadline is recorded as an expiry, not a clean submit.
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
      return serializeAttempt(updated, now);
    },
  );
};

/** Loads an attempt whose test is owned by the given key, or throws 404. */
async function findOwnedAttempt(
  id: string,
  ownerKeyId: string,
): Promise<AttemptRow> {
  const [row] = await db
    .select({ attempt: attempts })
    .from(attempts)
    .innerJoin(tests, eq(attempts.testId, tests.id))
    .where(and(eq(attempts.id, id), eq(tests.ownerKeyId, ownerKeyId)))
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
async function autoExpireIfDue(row: AttemptRow): Promise<AttemptRow> {
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
  return updated ?? row;
}
