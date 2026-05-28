import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { validateViolationEventBatch } from "@proctoring/shared";
import { and, asc, eq } from "drizzle-orm";
import { authenticateAdmin, authenticateAttempt } from "../auth.js";
import { db } from "../db/client.js";
import { type ViolationRow, violations } from "../db/schema/violations.js";
import { AppError, ErrorCode } from "../lib/errors.js";

function serialize(row: ViolationRow) {
  return {
    id: row.id,
    attemptId: row.attemptId,
    type: row.type,
    severity: row.severity,
    schemaVersion: row.schemaVersion,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    evidenceIds: row.evidenceIds,
    metadata: row.metadata ?? null,
    receivedAt: row.receivedAt.toISOString(),
  };
}

const ListQuery = Type.Object({
  attemptId: Type.String({ format: "uuid" }),
  limit: Type.Integer({ minimum: 1, maximum: 1000, default: 200 }),
  offset: Type.Integer({ minimum: 0, default: 0 }),
});

/**
 * The write hot path and a read API for reporting. Kept lean: authenticate,
 * validate against the shared schema, idempotently persist, return fast.
 */
export const violationRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    "/violations",
    {
      schema: {
        body: Type.Unknown(), // validated in-handler against the shared schema
        response: {
          200: Type.Object({
            accepted: Type.Integer(),
            stored: Type.Integer(),
            duplicates: Type.Integer(),
          }),
          400: Type.Ref("ErrorResponse"),
          401: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      const authed = await authenticateAttempt(request.headers.authorization);

      const result = validateViolationEventBatch(request.body);
      if (!result.valid) {
        throw new AppError(
          400,
          ErrorCode.VALIDATION,
          "Invalid violation batch",
          result.errors,
        );
      }
      const batch = result.value;
      if (batch.attemptId !== authed.attemptId) {
        throw AppError.badRequest(
          "Batch attemptId does not match the authenticated attempt",
        );
      }

      // Persist keyed by the authenticated attempt; idempotent by event id.
      const rows = batch.events.map((e) => ({
        id: e.id,
        attemptId: authed.attemptId,
        type: e.type,
        severity: e.severity,
        schemaVersion: e.schemaVersion,
        startedAt: new Date(e.startedAt),
        endedAt: e.endedAt ? new Date(e.endedAt) : null,
        durationMs: e.durationMs ?? null,
        evidenceIds: e.evidenceIds ?? [],
        metadata: e.metadata ?? null,
      }));

      const inserted = await db
        .insert(violations)
        .values(rows)
        .onConflictDoNothing({ target: violations.id })
        .returning({ id: violations.id });

      return {
        accepted: rows.length,
        stored: inserted.length,
        duplicates: rows.length - inserted.length,
      };
    },
  );

  app.get(
    "/violations",
    {
      schema: {
        querystring: ListQuery,
        response: {
          200: Type.Object({
            data: Type.Array(Type.Unknown()),
            pagination: Type.Object({
              limit: Type.Integer(),
              offset: Type.Integer(),
            }),
          }),
          401: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      // Read API for the reporting service — admin/service API key.
      await authenticateAdmin(request.headers.authorization);
      const { attemptId, limit, offset } = request.query;

      const rows = await db
        .select()
        .from(violations)
        .where(and(eq(violations.attemptId, attemptId)))
        .orderBy(asc(violations.startedAt))
        .limit(limit)
        .offset(offset);

      return { data: rows.map(serialize), pagination: { limit, offset } };
    },
  );
};
