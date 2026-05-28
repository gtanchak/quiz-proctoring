import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { testInvites, type TestInviteRow } from "../../db/schema/tests.js";
import { AppError } from "../../lib/errors.js";
import { findOwnedTest } from "../../lib/test-access.js";

const InviteEntity = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    testId: Type.String({ format: "uuid" }),
    email: Type.String(),
    createdAt: Type.String({ format: "date-time" }),
  },
  { $id: "Invite" },
);

function serializeInvite(row: TestInviteRow) {
  return {
    id: row.id,
    testId: row.testId,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
  };
}

const TestIdParams = Type.Object({ testId: Type.String({ format: "uuid" }) });
const InviteParams = Type.Object({
  testId: Type.String({ format: "uuid" }),
  inviteId: Type.String({ format: "uuid" }),
});

/**
 * Manage the invite allow-list for invite-only tests (admin, owner-scoped).
 * Emails are normalised to lower case so the candidate-side check is
 * case-insensitive. Invites can be edited at any time, including on a published
 * test — they don't change the test's structure.
 */
export const invitesRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    "/tests/:testId/invites",
    {
      schema: {
        tags: ["invites"],
        summary: "Invite a candidate email",
        security: [{ bearerAuth: [] }],
        params: TestIdParams,
        body: Type.Object({ email: Type.String({ format: "email" }) }),
        response: {
          201: InviteEntity,
          404: Type.Ref("ErrorResponse"),
          409: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request, reply) => {
      const test = await findOwnedTest(request.params.testId, request.apiKey!.id);
      const email = request.body.email.trim().toLowerCase();

      const [row] = await db
        .insert(testInvites)
        .values({ testId: test.id, email })
        .onConflictDoNothing({
          target: [testInvites.testId, testInvites.email],
        })
        .returning();
      if (!row) {
        throw AppError.conflict("Email is already invited");
      }
      reply.status(201);
      return serializeInvite(row);
    },
  );

  app.get(
    "/tests/:testId/invites",
    {
      schema: {
        tags: ["invites"],
        summary: "List invited candidate emails",
        security: [{ bearerAuth: [] }],
        params: TestIdParams,
        response: {
          200: Type.Array(InviteEntity),
          404: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      const test = await findOwnedTest(request.params.testId, request.apiKey!.id);
      const rows = await db
        .select()
        .from(testInvites)
        .where(eq(testInvites.testId, test.id))
        .orderBy(asc(testInvites.email));
      return rows.map(serializeInvite);
    },
  );

  app.delete(
    "/tests/:testId/invites/:inviteId",
    {
      schema: {
        tags: ["invites"],
        summary: "Remove a candidate invite",
        security: [{ bearerAuth: [] }],
        params: InviteParams,
        response: {
          204: Type.Null(),
          404: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request, reply) => {
      const test = await findOwnedTest(request.params.testId, request.apiKey!.id);
      const [row] = await db
        .delete(testInvites)
        .where(
          and(
            eq(testInvites.id, request.params.inviteId),
            eq(testInvites.testId, test.id),
          ),
        )
        .returning({ id: testInvites.id });
      if (!row) {
        throw AppError.notFound("Invite not found");
      }
      reply.status(204);
      return null;
    },
  );
};
