import { Controller, Delete, Get, Param } from "@nestjs/common";
import { Type } from "@sinclair/typebox";
import { type EvidenceItem } from "@proctoring/shared";
import { and, desc, eq } from "drizzle-orm";
import { Auth } from "../auth/auth.decorator.js";
import type { RequestAuth } from "../auth/request-auth.js";
import { RequireWrite } from "../auth/roles.decorator.js";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { attempts, evidence, tests } from "../db/schema/tests.js";
import { AuditAction, recordAudit } from "../lib/audit.js";
import { AppError } from "../lib/errors.js";
import { getEvidenceStore } from "../lib/evidence-store.js";
import { validate } from "../lib/validate.js";

const IdParams = Type.Object({ id: Type.String({ format: "uuid" }) });

/**
 * Admin-facing evidence retrieval & deletion (PRO-27). core-api owns the
 * evidence index (the `evidence` table); the bytes live in S3 and are only ever
 * handed out as signed, expiring URLs (CLAUDE.md §5 — never public/guessable).
 */
@Controller("v1")
export class EvidenceController {
  @Get("attempts/:id/evidence")
  async list(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
  ) {
    const { id } = validate(IdParams, params);
    const attemptId = await requireOwnedAttempt(id, auth.orgId);
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
  }

  @Delete("attempts/:id/evidence")
  @RequireWrite()
  async remove(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
  ) {
    const { id } = validate(IdParams, params);
    const attemptId = await requireOwnedAttempt(id, auth.orgId);
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

    recordAudit({
      orgId: auth.orgId,
      actorType: auth.actorType,
      actorUserId: auth.userId ?? null,
      action: AuditAction.EVIDENCE_DELETED,
      targetType: "attempt",
      targetId: attemptId,
      metadata: { count: rows.length },
    });

    return { deleted: rows.length };
  }
}

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
