import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { attempts, tests, type AttemptRow } from "../../db/schema/tests.js";
import { AppError } from "../../lib/errors.js";

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
    submittedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    createdAt: Type.String({ format: "date-time" }),
  },
  { $id: "Attempt" },
);

export function serializeAttempt(row: AttemptRow) {
  return {
    id: row.id,
    testId: row.testId,
    candidateEmail: row.candidateEmail,
    status: row.status,
    startedAt: row.startedAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const IdParams = Type.Object({ id: Type.String({ format: "uuid" }) });

/**
 * Read a single attempt. Scoped through its parent test's owner: an attempt
 * belonging to another tenant's test is reported as 404. Attempt *creation* is
 * the candidate-facing flow (separate issues); this is the admin read side.
 */
export const attemptsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/attempts/:id",
    {
      schema: {
        tags: ["attempts"],
        summary: "Get an attempt",
        security: [{ bearerAuth: [] }],
        params: IdParams,
        response: { 200: AttemptEntity, 404: Type.Ref("ErrorResponse") },
      },
    },
    async (request) => {
      const [row] = await db
        .select({ attempt: attempts })
        .from(attempts)
        .innerJoin(tests, eq(attempts.testId, tests.id))
        .where(
          and(
            eq(attempts.id, request.params.id),
            eq(tests.ownerKeyId, request.apiKey!.id),
          ),
        )
        .limit(1);

      if (!row) {
        throw AppError.notFound("Attempt not found");
      }
      return serializeAttempt(row.attempt);
    },
  );
};
