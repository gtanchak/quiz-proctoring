import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Res,
} from "@nestjs/common";
import { Type } from "@sinclair/typebox";
import {
  SnapshotMetadataSchema,
  SessionPhaseSchema,
  type SessionProgress,
  canAdvanceSession,
} from "@proctoring/shared";
import { and, count, eq, inArray } from "drizzle-orm";
import type { Response } from "express";
import { config } from "../config.js";
import { db } from "../db/client.js";
import {
  attempts,
  type AttemptRow,
  evidence,
  questions,
  responses,
  testInvites,
  tests,
} from "../db/schema/tests.js";
import {
  generateSessionToken,
  hashSessionToken,
  linkState,
} from "../lib/access.js";
import { AppError } from "../lib/errors.js";
import { getEvidenceStore } from "../lib/evidence-store.js";
import { recordSessionEvent } from "../lib/session-events.js";
import { computeDeadline, timerState } from "../lib/timer.js";
import { validate } from "../lib/validate.js";
import {
  autoExpireIfDue,
  finalizeAttempt,
  serializeAttempt,
} from "./attempts.controller.js";

const TokenParams = Type.Object({ token: Type.String() });
const StartBody = Type.Object(
  {
    candidateEmail: Type.String({ format: "email" }),
    /** Candidate consent to data/recording, required before start (FR-18). */
    consent: Type.Boolean(),
  },
  { additionalProperties: false },
);
const AdvanceBody = Type.Object(
  { to: SessionPhaseSchema },
  { additionalProperties: false },
);
const AnswersBody = Type.Object(
  {
    answers: Type.Array(
      Type.Object({
        questionId: Type.String({ format: "uuid" }),
        selectedOptionIds: Type.Array(Type.String(), { maxItems: 100 }),
      }),
      { minItems: 1, maxItems: 500 },
    ),
  },
  { additionalProperties: false },
);

/**
 * Candidate-facing endpoints reached via a test's share link. No admin API key
 * (the global {@link AuthGuard} skips `/v1/public`): the landing is open, and
 * attempt actions are authorized by the per-attempt session token issued at
 * start. The countdown UI that consumes these lives in candidate-web.
 */
@Controller("v1/public")
export class PublicController {
  @Get("tests/:token")
  async landing(@Param() params: Record<string, string>) {
    const { token } = validate(TokenParams, params);
    const test = await findTestByToken(token);
    return {
      title: test.title,
      instructions: test.instructions,
      durationMinutes: test.durationMinutes,
      accessMode: test.accessMode,
      state: linkState(test),
      // Pre-start device checks the candidate must pass, gated by modality
      // (FR-12). Empty/all-false means no device check is required (e.g. MCQ).
      deviceCheck: test.proctoring,
    };
  }

  @Post("tests/:token/start")
  async start(
    @Param() params: Record<string, string>,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token } = validate(TokenParams, params);
    const dto = validate(StartBody, body);
    const test = await findTestByToken(token);
    const now = new Date();

    const state = linkState(test, now);
    if (state !== "open") {
      throw new AppError(409, "CONFLICT", `This link is ${state}`, { state });
    }

    // Consent is captured before any attempt begins (FR-18, CLAUDE.md §6).
    if (!dto.consent) {
      throw AppError.badRequest("Consent is required to start the assessment");
    }

    const email = dto.candidateEmail.trim().toLowerCase();

    if (test.accessMode === "invite") {
      const [invited] = await db
        .select({ id: testInvites.id })
        .from(testInvites)
        .where(and(eq(testInvites.testId, test.id), eq(testInvites.email, email)))
        .limit(1);
      if (!invited) {
        throw AppError.forbidden("This email is not invited to this test");
      }
    }

    // Resume an existing in-progress attempt (re-issuing a session token),
    // unless it has since expired.
    const [existing] = await db
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.testId, test.id),
          eq(attempts.candidateEmail, email),
          eq(attempts.status, "in_progress"),
        ),
      )
      .limit(1);
    if (existing) {
      const live = await autoExpireIfDue(existing);
      if (live.status === "in_progress") {
        const session = generateSessionToken();
        const [resumed] = await db
          .update(attempts)
          .set({ sessionTokenHash: session.hash })
          .where(eq(attempts.id, live.id))
          .returning();
        await recordSessionEvent(resumed.id, "session_resumed", {
          phase: resumed.phase,
        });
        res.status(200);
        return {
          attempt: serializeAttempt(resumed, now),
          sessionToken: session.token,
          resumed: true,
        };
      }
    }

    // Enforce max-attempts against finalized attempts for this candidate.
    const [{ used }] = await db
      .select({ used: count() })
      .from(attempts)
      .where(
        and(
          eq(attempts.testId, test.id),
          eq(attempts.candidateEmail, email),
          inArray(attempts.status, ["submitted", "expired", "abandoned"]),
        ),
      );
    if (used >= test.maxAttempts) {
      throw AppError.forbidden("No attempts remaining for this test");
    }

    const session = generateSessionToken();
    const [row] = await db
      .insert(attempts)
      .values({
        testId: test.id,
        candidateEmail: email,
        status: "in_progress",
        phase: "intro",
        consentAt: now,
        startedAt: now,
        deadlineAt: computeDeadline(now, test.durationMinutes),
        sessionTokenHash: session.hash,
      })
      .returning();
    await recordSessionEvent(row.id, "session_started", { phase: "intro" });
    res.status(201);
    return {
      attempt: serializeAttempt(row, now),
      sessionToken: session.token,
      resumed: false,
    };
  }

  @Get("attempt")
  async getAttempt(@Headers("authorization") authorization: string | undefined) {
    const row = await resolveAttemptBySession(authorization);
    return serializeAttempt(await autoExpireIfDue(row));
  }

  /**
   * Visible progress + server-authoritative time remaining (FR-16). Safe to
   * call any time, including right after a reconnect (FR-17) to re-sync the
   * candidate's countdown against the server clock.
   */
  @Get("attempt/progress")
  async progress(
    @Headers("authorization") authorization: string | undefined,
  ): Promise<SessionProgress> {
    const attempt = await autoExpireIfDue(
      await resolveAttemptBySession(authorization),
    );
    const [[{ total }], [{ answered }]] = await Promise.all([
      db
        .select({ total: count() })
        .from(questions)
        .where(eq(questions.testId, attempt.testId)),
      db
        .select({ answered: count() })
        .from(responses)
        .where(eq(responses.attemptId, attempt.id)),
    ]);
    return {
      phase: attempt.phase,
      answered,
      total,
      remainingMs: timerState(attempt).remainingMs,
    };
  }

  @Post("attempt/advance")
  @HttpCode(200)
  async advance(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const { to } = validate(AdvanceBody, body);
    const attempt = await autoExpireIfDue(
      await resolveAttemptBySession(authorization),
    );
    if (attempt.status !== "in_progress") {
      throw AppError.conflict("Attempt is not in progress");
    }
    // `complete` is reached by submitting, never a free advance.
    if (to === "complete") {
      throw AppError.badRequest("Submit the attempt to complete it");
    }
    if (!canAdvanceSession(attempt.phase, to)) {
      throw AppError.badRequest(
        `Cannot advance the session from ${attempt.phase} to ${to}`,
      );
    }
    const [updated] = await db
      .update(attempts)
      .set({ phase: to })
      .where(eq(attempts.id, attempt.id))
      .returning();
    await recordSessionEvent(updated.id, "phase_changed", { phase: to });
    return serializeAttempt(updated);
  }

  @Post("attempt/submit")
  @HttpCode(200)
  async submit(@Headers("authorization") authorization: string | undefined) {
    const row = await resolveAttemptBySession(authorization);
    return serializeAttempt(await finalizeAttempt(row));
  }

  @Put("attempt/answers")
  async saveAnswers(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const dto = validate(AnswersBody, body);
    const attempt = await autoExpireIfDue(
      await resolveAttemptBySession(authorization),
    );
    if (attempt.status !== "in_progress") {
      throw AppError.conflict("Attempt is not in progress");
    }

    const validIds = new Set(
      (
        await db
          .select({ id: questions.id })
          .from(questions)
          .where(eq(questions.testId, attempt.testId))
      ).map((q) => q.id),
    );
    for (const answer of dto.answers) {
      if (!validIds.has(answer.questionId)) {
        throw AppError.badRequest(
          `Question ${answer.questionId} does not belong to this test`,
        );
      }
    }

    for (const answer of dto.answers) {
      await db
        .insert(responses)
        .values({
          attemptId: attempt.id,
          questionId: answer.questionId,
          selectedOptionIds: answer.selectedOptionIds,
        })
        .onConflictDoUpdate({
          target: [responses.attemptId, responses.questionId],
          set: {
            selectedOptionIds: answer.selectedOptionIds,
            updatedAt: new Date(),
          },
        });
    }
    await recordSessionEvent(attempt.id, "answers_saved", {
      phase: attempt.phase,
      data: { count: dto.answers.length },
    });
    return { saved: dto.answers.length };
  }

  @Post("attempt/snapshots")
  @HttpCode(201)
  async snapshots(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const meta = validate(SnapshotMetadataSchema, body);
    const attempt = await autoExpireIfDue(
      await resolveAttemptBySession(authorization),
    );
    // Snapshots are only accepted while the attempt is live; a finished
    // attempt can no longer accumulate evidence.
    if (attempt.status !== "in_progress") {
      throw AppError.conflict("Attempt is not in progress");
    }

    if (meta.byteSize > config.EVIDENCE_MAX_BYTES) {
      throw AppError.badRequest("Snapshot exceeds the maximum allowed size");
    }

    const store = getEvidenceStore();
    // Key is derived from the session attempt (not the client-supplied
    // metadata.attemptId), so a candidate can only ever write under its own
    // attempt's prefix.
    const key = store.keyFor(attempt.id, meta.id);

    // Record the evidence row before handing out the upload URL. The snapshot
    // id is client-generated, so a retried grant is idempotent (no duplicate
    // row); the bytes land at the same deterministic key either way.
    await db
      .insert(evidence)
      .values({
        id: meta.id,
        attemptId: attempt.id,
        kind: meta.kind,
        contentType: meta.contentType,
        byteSize: meta.byteSize,
        width: meta.width,
        height: meta.height,
        capturedAt: new Date(meta.capturedAt),
        storageKey: key,
      })
      .onConflictDoNothing({ target: evidence.id });

    const grant = await store.presignUpload(key, meta.contentType);
    await recordSessionEvent(attempt.id, "snapshot_captured", {
      phase: attempt.phase,
      data: { snapshotId: meta.id, kind: meta.kind },
    });
    const expiresAt = new Date(
      Date.now() + config.EVIDENCE_UPLOAD_URL_TTL * 1000,
    ).toISOString();
    return {
      snapshotId: meta.id,
      key,
      url: grant.url,
      method: "PUT" as const,
      headers: grant.headers,
      expiresAt,
    };
  }

  @Get("attempt/result")
  async result(@Headers("authorization") authorization: string | undefined) {
    const attempt = await autoExpireIfDue(
      await resolveAttemptBySession(authorization),
    );
    if (attempt.status === "in_progress") {
      throw AppError.conflict("Attempt has not been submitted yet");
    }

    const [qs, rs] = await Promise.all([
      db
        .select({ id: questions.id, points: questions.points })
        .from(questions)
        .where(eq(questions.testId, attempt.testId)),
      db.select().from(responses).where(eq(responses.attemptId, attempt.id)),
    ]);
    const awarded = new Map(rs.map((r) => [r.questionId, r.awardedPoints]));

    return {
      status: attempt.status,
      score: attempt.score,
      maxScore: attempt.maxScore,
      // Per-question awarded points — never the correct answers.
      breakdown: qs.map((q) => ({
        questionId: q.id,
        points: q.points,
        awardedPoints: awarded.get(q.id) ?? 0,
      })),
    };
  }
}

async function findTestByToken(token: string) {
  const [test] = await db
    .select()
    .from(tests)
    .where(eq(tests.accessToken, token))
    .limit(1);
  if (!test) {
    throw AppError.notFound("Test link not found");
  }
  return test;
}

/** Resolves the attempt for the request's `Authorization: Bearer <session>`. */
async function resolveAttemptBySession(
  authorization: string | undefined,
): Promise<AttemptRow> {
  if (!authorization?.startsWith("Bearer ")) {
    throw AppError.unauthorized("Missing attempt session token");
  }
  const token = authorization.slice("Bearer ".length).trim();
  const [row] = await db
    .select()
    .from(attempts)
    .where(eq(attempts.sessionTokenHash, hashSessionToken(token)))
    .limit(1);
  if (!row) {
    throw AppError.unauthorized("Invalid attempt session token");
  }
  return row;
}
