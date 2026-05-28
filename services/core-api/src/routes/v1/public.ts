import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { and, count, eq, inArray } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { db } from "../../db/client.js";
import { attempts, testInvites, tests, type AttemptRow } from "../../db/schema/tests.js";
import {
  generateSessionToken,
  hashSessionToken,
  linkState,
} from "../../lib/access.js";
import { AppError } from "../../lib/errors.js";
import { computeDeadline } from "../../lib/timer.js";
import {
  AttemptEntity,
  autoExpireIfDue,
  finalizeAttempt,
  serializeAttempt,
} from "./attempts.js";

const LinkState = Type.Union([
  Type.Literal("not_yet_open"),
  Type.Literal("open"),
  Type.Literal("closed"),
]);

const TokenParams = Type.Object({ token: Type.String() });

const Landing = Type.Object({
  title: Type.String(),
  instructions: Type.Union([Type.String(), Type.Null()]),
  durationMinutes: Type.Union([Type.Integer(), Type.Null()]),
  accessMode: Type.Union([Type.Literal("open"), Type.Literal("invite")]),
  state: LinkState,
});

const StartBody = Type.Object(
  { candidateEmail: Type.String({ format: "email" }) },
  { additionalProperties: false },
);

const StartResponse = Type.Object({
  attempt: AttemptEntity,
  /** Per-attempt session token — send as `Authorization: Bearer` on poll/submit. */
  sessionToken: Type.String(),
  /** True when an existing in-progress attempt was resumed rather than created. */
  resumed: Type.Boolean(),
});

/**
 * Candidate-facing endpoints reached via a test's share link. No admin API key
 * (the admin-auth hook skips `/v1/public`): the landing is open, and attempt
 * actions are authorized by the per-attempt session token issued at start.
 *
 * The countdown UI that consumes these lives in candidate-web.
 */
export const publicRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/public/tests/:token",
    {
      schema: {
        tags: ["public"],
        summary: "Candidate landing info for a share link",
        params: TokenParams,
        response: { 200: Landing, 404: Type.Ref("ErrorResponse") },
      },
    },
    async (request) => {
      const test = await findTestByToken(request.params.token);
      return {
        title: test.title,
        instructions: test.instructions,
        durationMinutes: test.durationMinutes,
        accessMode: test.accessMode,
        state: linkState(test),
      };
    },
  );

  app.post(
    "/public/tests/:token/start",
    {
      schema: {
        tags: ["public"],
        summary: "Start (or resume) an attempt via a share link",
        params: TokenParams,
        body: StartBody,
        response: {
          200: StartResponse, // resumed an existing in-progress attempt
          201: StartResponse, // started a new attempt
          403: Type.Ref("ErrorResponse"),
          404: Type.Ref("ErrorResponse"),
          409: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request, reply) => {
      const test = await findTestByToken(request.params.token);
      const now = new Date();

      const state = linkState(test, now);
      if (state !== "open") {
        throw new AppError(409, "CONFLICT", `This link is ${state}`, { state });
      }

      const email = request.body.candidateEmail.trim().toLowerCase();

      if (test.accessMode === "invite") {
        const [invited] = await db
          .select({ id: testInvites.id })
          .from(testInvites)
          .where(
            and(eq(testInvites.testId, test.id), eq(testInvites.email, email)),
          )
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
          return { attempt: serializeAttempt(resumed, now), sessionToken: session.token, resumed: true };
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
          startedAt: now,
          deadlineAt: computeDeadline(now, test.durationMinutes),
          sessionTokenHash: session.hash,
        })
        .returning();
      reply.status(201);
      return { attempt: serializeAttempt(row, now), sessionToken: session.token, resumed: false };
    },
  );

  app.get(
    "/public/attempt",
    {
      schema: {
        tags: ["public"],
        summary: "Get the current attempt (by session token)",
        security: [{ bearerAuth: [] }],
        response: { 200: AttemptEntity, 401: Type.Ref("ErrorResponse") },
      },
    },
    async (request) => {
      const row = await resolveAttemptBySession(request);
      return serializeAttempt(await autoExpireIfDue(row));
    },
  );

  app.post(
    "/public/attempt/submit",
    {
      schema: {
        tags: ["public"],
        summary: "Submit and lock the current attempt (by session token)",
        security: [{ bearerAuth: [] }],
        response: {
          200: AttemptEntity,
          401: Type.Ref("ErrorResponse"),
          409: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      const row = await resolveAttemptBySession(request);
      return serializeAttempt(await finalizeAttempt(row));
    },
  );
};

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
  request: FastifyRequest,
): Promise<AttemptRow> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw AppError.unauthorized("Missing attempt session token");
  }
  const token = header.slice("Bearer ".length).trim();
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
