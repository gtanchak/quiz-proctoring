import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { AttemptEvidenceSchema, type EvidenceItem } from "@proctoring/shared";
import { and, desc, eq } from "drizzle-orm";
import { config } from "../../config.js";
import { db } from "../../db/client.js";
import { attempts, evidence, tests } from "../../db/schema/tests.js";
import { AuditAction, recordAudit } from "../../lib/audit.js";
import { requireWrite } from "../../lib/authz.js";
import { AppError } from "../../lib/errors.js";
import { getEvidenceStore } from "../../lib/evidence-store.js";

const IdParams = Type.Object({ id: Type.String({ format: "uuid" }) });

const DeleteEvidenceResponse = Type.Object({
  deleted: Type.Integer({ description: "Number of evidence items erased." }),
});

/**
 * Admin-facing evidence retrieval & deletion (PRO-27). core-api owns the
 * evidence index (the `evidence` table); the bytes live in S3 and are only ever
 * handed out as signed, expiring URLs (CLAUDE.md §5 — never public/guessable).
 *
 * The report viewer correlates these items to the violation timeline via
 * `ReportViolation.evidenceIds`; periodic snapshots not tied to a violation
 * still appear here so an admin can browse the full capture gallery.
 */
export const evidenceRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/attempts/:id/evidence",
    {
      schema: {
        tags: ["reports"],
        summary: "List an attempt's evidence with signed, expiring URLs",
        security: [{ bearerAuth: [] }],
        params: IdParams,
        response: {
          200: AttemptEvidenceSchema,
          404: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      const attemptId = await requireOwnedAttempt(
        request.params.id,
        request.auth!.orgId,
      );
      const rows = await db
        .select()
        .from(evidence)
        .where(eq(evidence.attemptId, attemptId))
        .orderBy(desc(evidence.capturedAt));

      const store = getEvidenceStore();
      // One expiry stamp for the whole batch — all URLs are minted together.
      const expiresAt = new Date(
        Date.now() + config.EVIDENCE_GET_URL_TTL * 1000,
      ).toISOString();
      const items: EvidenceItem[] = await Promise.all(
        rows.map(async (r) => ({
          id: r.id,
          attemptId: r.attemptId,
          kind: r.kind,
          contentType: r.contentType,
          byteSize: r.byteSize,
          width: r.width,
          height: r.height,
          capturedAt: r.capturedAt.toISOString(),
          url: await store.presignDownload(r.storageKey),
          expiresAt,
        })),
      );
      return { attemptId, items };
    },
  );

  app.delete(
    "/attempts/:id/evidence",
    {
      preHandler: requireWrite,
      schema: {
        tags: ["reports"],
        summary: "Permanently delete all of an attempt's evidence",
        description:
          "Erases the stored bytes and their index rows. Surfaced in the report " +
          "for an admin; the broader retention/erasure flow is PRO-41.",
        security: [{ bearerAuth: [] }],
        params: IdParams,
        response: {
          200: DeleteEvidenceResponse,
          403: Type.Ref("ErrorResponse"),
          404: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      const attemptId = await requireOwnedAttempt(
        request.params.id,
        request.auth!.orgId,
      );
      const rows = await db
        .select({ storageKey: evidence.storageKey })
        .from(evidence)
        .where(eq(evidence.attemptId, attemptId));

      if (rows.length > 0) {
        // Erase the bytes first; only drop the index rows once storage is clear,
        // so a failed object delete leaves a retryable, consistent state.
        await getEvidenceStore().deleteObjects(rows.map((r) => r.storageKey));
        await db.delete(evidence).where(eq(evidence.attemptId, attemptId));
      }

      recordAudit(request.log, {
        orgId: request.auth!.orgId,
        actorType: request.auth!.actorType,
        actorUserId: request.auth!.userId ?? null,
        action: AuditAction.EVIDENCE_DELETED,
        targetType: "attempt",
        targetId: attemptId,
        metadata: { count: rows.length },
      });

      return { deleted: rows.length };
    },
  );
};

/** Resolves an attempt id whose test belongs to the org, or throws 404. */
async function requireOwnedAttempt(id: string, orgId: string): Promise<string> {
  const [row] = await db
    .select({ id: attempts.id })
    .from(attempts)
    .innerJoin(tests, eq(attempts.testId, tests.id))
    .where(and(eq(attempts.id, id), eq(tests.orgId, orgId)))
    .limit(1);
  if (!row) {
    throw AppError.notFound("Attempt not found");
  }
  return row.id;
}
