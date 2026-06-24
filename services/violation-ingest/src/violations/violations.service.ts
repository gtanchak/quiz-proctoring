import { Injectable } from "@nestjs/common";
import { validateViolationEventBatch } from "@proctoring/shared";
import { and, asc, eq } from "drizzle-orm";
import { AuthService } from "../auth.service.js";
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

export interface ListQuery {
  attemptId: string;
  limit: number;
  offset: number;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parses + validates the read-API querystring (mirrors the old TypeBox schema). */
export function parseListQuery(query: Record<string, unknown>): ListQuery {
  const attemptId = String(query.attemptId ?? "");
  if (!UUID_RE.test(attemptId)) {
    throw AppError.badRequest("Query 'attemptId' must be a UUID");
  }
  const limit = clampInt(query.limit, 200, 1, 1000);
  const offset = clampInt(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  return { attemptId, limit, offset };
}

function clampInt(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw AppError.badRequest("Invalid pagination parameter");
  }
  return n;
}

/**
 * The write hot path and a read API for reporting. Kept lean: authenticate,
 * validate against the shared schema, idempotently persist, return fast.
 */
@Injectable()
export class ViolationsService {
  constructor(private readonly auth: AuthService) {}

  async ingest(authorization: string | undefined, body: unknown) {
    const authed = await this.auth.authenticateAttempt(authorization);

    const result = validateViolationEventBatch(body);
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
  }

  async list(authorization: string | undefined, query: Record<string, unknown>) {
    // Read API for the reporting service — admin/service API key.
    await this.auth.authenticateAdmin(authorization);
    const { attemptId, limit, offset } = parseListQuery(query);

    const rows = await db
      .select()
      .from(violations)
      .where(and(eq(violations.attemptId, attemptId)))
      .orderBy(asc(violations.startedAt))
      .limit(limit)
      .offset(offset);

    return { data: rows.map(serialize), pagination: { limit, offset } };
  }
}
