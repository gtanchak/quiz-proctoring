import { randomBytes } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { questions, tests, type TestRow } from "../../db/schema/tests.js";
import { requireWrite } from "../../lib/authz.js";
import { AppError } from "../../lib/errors.js";
import { PaginationQuery, paginated } from "../../lib/pagination.js";
import { assertTestMutable, findOrgTest } from "../../lib/test-access.js";

const TestStatus = Type.Union([
  Type.Literal("draft"),
  Type.Literal("published"),
  Type.Literal("archived"),
]);

const AccessMode = Type.Union([Type.Literal("open"), Type.Literal("invite")]);

/** Opaque shareable-link id, generated once per test at creation. */
function generateAccessToken(): string {
  return randomBytes(16).toString("base64url");
}

const TestEntity = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    title: Type.String(),
    description: Type.Union([Type.String(), Type.Null()]),
    instructions: Type.Union([Type.String(), Type.Null()]),
    status: TestStatus,
    durationMinutes: Type.Union([Type.Integer(), Type.Null()]),
    availableFrom: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    availableUntil: Type.Union([
      Type.String({ format: "date-time" }),
      Type.Null(),
    ]),
    maxAttempts: Type.Integer(),
    passMark: Type.Union([Type.Integer(), Type.Null()]),
    negativeMarking: Type.Boolean(),
    accessMode: AccessMode,
    accessToken: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
  },
  { $id: "Test" },
);

function serializeTest(row: TestRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    instructions: row.instructions,
    status: row.status,
    durationMinutes: row.durationMinutes,
    availableFrom: row.availableFrom?.toISOString() ?? null,
    availableUntil: row.availableUntil?.toISOString() ?? null,
    maxAttempts: row.maxAttempts,
    passMark: row.passMark,
    negativeMarking: row.negativeMarking,
    accessMode: row.accessMode,
    accessToken: row.accessToken,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Status is not settable directly — it changes only via publish/unpublish.
const CreateTestBody = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Optional(Type.String({ maxLength: 2000 })),
    instructions: Type.Optional(Type.String({ maxLength: 5000 })),
    durationMinutes: Type.Optional(Type.Integer({ minimum: 1 })),
    availableFrom: Type.Optional(Type.String({ format: "date-time" })),
    availableUntil: Type.Optional(Type.String({ format: "date-time" })),
    maxAttempts: Type.Optional(Type.Integer({ minimum: 1 })),
    passMark: Type.Optional(Type.Integer({ minimum: 0 })),
    negativeMarking: Type.Optional(Type.Boolean()),
    accessMode: Type.Optional(AccessMode),
  },
  { additionalProperties: false },
);

const UpdateTestBody = Type.Partial(CreateTestBody, {
  additionalProperties: false,
});

const ListTestsQuery = Type.Composite([
  PaginationQuery,
  Type.Object({
    status: Type.Optional(TestStatus),
    sort: Type.Optional(
      Type.Union([Type.Literal("createdAt"), Type.Literal("title")], {
        default: "createdAt",
      }),
    ),
    order: Type.Optional(
      Type.Union([Type.Literal("asc"), Type.Literal("desc")], {
        default: "desc",
      }),
    ),
  }),
]);

const IdParams = Type.Object({ id: Type.String({ format: "uuid" }) });

/**
 * Tests CRUD, the publish lifecycle, and nested attempts listing. Every row is
 * scoped to the calling actor's organization (`orgId`): a row in another org or
 * a missing row returns 404, never 403, to avoid leaking existence across
 * tenants. Mutations additionally require a write role (`requireWrite`).
 */
export const testsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    "/tests",
    {
      preHandler: requireWrite,
      schema: {
        tags: ["tests"],
        summary: "Create a test (draft)",
        security: [{ bearerAuth: [] }],
        body: CreateTestBody,
        response: {
          201: TestEntity,
          400: Type.Ref("ErrorResponse"),
          403: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const from = body.availableFrom ? new Date(body.availableFrom) : undefined;
      const until = body.availableUntil
        ? new Date(body.availableUntil)
        : undefined;
      assertValidWindow(from ?? null, until ?? null);

      const [row] = await db
        .insert(tests)
        .values({
          orgId: request.auth!.orgId,
          title: body.title,
          description: body.description,
          instructions: body.instructions,
          durationMinutes: body.durationMinutes,
          availableFrom: from,
          availableUntil: until,
          maxAttempts: body.maxAttempts,
          passMark: body.passMark,
          negativeMarking: body.negativeMarking,
          accessMode: body.accessMode,
          accessToken: generateAccessToken(),
        })
        .returning();
      reply.status(201);
      return serializeTest(row);
    },
  );

  app.get(
    "/tests",
    {
      schema: {
        tags: ["tests"],
        summary: "List tests",
        security: [{ bearerAuth: [] }],
        querystring: ListTestsQuery,
        response: { 200: paginated(TestEntity) },
      },
    },
    async (request) => {
      const { limit, offset, status, sort, order } = request.query;
      const where = status
        ? and(eq(tests.orgId, request.auth!.orgId), eq(tests.status, status))
        : eq(tests.orgId, request.auth!.orgId);

      const column = sort === "title" ? tests.title : tests.createdAt;
      const direction = order === "asc" ? asc(column) : desc(column);

      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(tests)
          .where(where)
          .orderBy(direction)
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(tests).where(where),
      ]);

      return {
        data: rows.map(serializeTest),
        pagination: { total, limit, offset },
      };
    },
  );

  app.get(
    "/tests/:id",
    {
      schema: {
        tags: ["tests"],
        summary: "Get a test",
        security: [{ bearerAuth: [] }],
        params: IdParams,
        response: { 200: TestEntity, 404: Type.Ref("ErrorResponse") },
      },
    },
    async (request) => {
      const row = await findOrgTest(request.params.id, request.auth!.orgId);
      return serializeTest(row);
    },
  );

  app.patch(
    "/tests/:id",
    {
      preHandler: requireWrite,
      schema: {
        tags: ["tests"],
        summary: "Update a test",
        security: [{ bearerAuth: [] }],
        params: IdParams,
        body: UpdateTestBody,
        response: {
          200: TestEntity,
          400: Type.Ref("ErrorResponse"),
          403: Type.Ref("ErrorResponse"),
          404: Type.Ref("ErrorResponse"),
          409: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      const existing = await findOrgTest(
        request.params.id,
        request.auth!.orgId,
      );
      await assertTestMutable(existing);

      const body = request.body;
      // Validate the resulting window against the merged state.
      const effFrom =
        body.availableFrom !== undefined
          ? new Date(body.availableFrom)
          : existing.availableFrom;
      const effUntil =
        body.availableUntil !== undefined
          ? new Date(body.availableUntil)
          : existing.availableUntil;
      assertValidWindow(effFrom, effUntil);

      const [row] = await db
        .update(tests)
        .set({
          ...(body.title !== undefined && { title: body.title }),
          ...(body.description !== undefined && {
            description: body.description,
          }),
          ...(body.instructions !== undefined && {
            instructions: body.instructions,
          }),
          ...(body.durationMinutes !== undefined && {
            durationMinutes: body.durationMinutes,
          }),
          ...(body.availableFrom !== undefined && {
            availableFrom: new Date(body.availableFrom),
          }),
          ...(body.availableUntil !== undefined && {
            availableUntil: new Date(body.availableUntil),
          }),
          ...(body.maxAttempts !== undefined && {
            maxAttempts: body.maxAttempts,
          }),
          ...(body.passMark !== undefined && { passMark: body.passMark }),
          ...(body.negativeMarking !== undefined && {
            negativeMarking: body.negativeMarking,
          }),
          ...(body.accessMode !== undefined && { accessMode: body.accessMode }),
          updatedAt: new Date(),
        })
        .where(eq(tests.id, existing.id))
        .returning();
      return serializeTest(row);
    },
  );

  app.delete(
    "/tests/:id",
    {
      preHandler: requireWrite,
      schema: {
        tags: ["tests"],
        summary: "Delete a test",
        security: [{ bearerAuth: [] }],
        params: IdParams,
        response: {
          204: Type.Null(),
          403: Type.Ref("ErrorResponse"),
          404: Type.Ref("ErrorResponse"),
          409: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request, reply) => {
      const existing = await findOrgTest(
        request.params.id,
        request.auth!.orgId,
      );
      await assertTestMutable(existing);
      await db.delete(tests).where(eq(tests.id, existing.id));
      reply.status(204);
      return null;
    },
  );

  app.post(
    "/tests/:id/publish",
    {
      preHandler: requireWrite,
      schema: {
        tags: ["tests"],
        summary: "Publish a test",
        description:
          "Validates the test (at least one question, valid availability window) then marks it published.",
        security: [{ bearerAuth: [] }],
        params: IdParams,
        response: {
          200: TestEntity,
          403: Type.Ref("ErrorResponse"),
          404: Type.Ref("ErrorResponse"),
          409: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      const test = await findOrgTest(request.params.id, request.auth!.orgId);

      assertValidWindow(test.availableFrom, test.availableUntil);

      const [{ total: questionCount }] = await db
        .select({ total: count() })
        .from(questions)
        .where(eq(questions.testId, test.id));
      if (questionCount === 0) {
        throw AppError.conflict("Cannot publish a test with no questions");
      }

      const [row] = await db
        .update(tests)
        .set({ status: "published", updatedAt: new Date() })
        .where(eq(tests.id, test.id))
        .returning();
      return serializeTest(row);
    },
  );

  app.post(
    "/tests/:id/unpublish",
    {
      preHandler: requireWrite,
      schema: {
        tags: ["tests"],
        summary: "Unpublish a test (back to draft)",
        security: [{ bearerAuth: [] }],
        params: IdParams,
        response: {
          200: TestEntity,
          403: Type.Ref("ErrorResponse"),
          404: Type.Ref("ErrorResponse"),
          409: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      const test = await findOrgTest(request.params.id, request.auth!.orgId);
      await assertTestMutable(test);
      const [row] = await db
        .update(tests)
        .set({ status: "draft", updatedAt: new Date() })
        .where(eq(tests.id, test.id))
        .returning();
      return serializeTest(row);
    },
  );

};

/** Rejects an availability window whose end is not after its start. */
function assertValidWindow(from: Date | null, until: Date | null): void {
  if (from && until && from.getTime() >= until.getTime()) {
    throw AppError.badRequest(
      "available_until must be after available_from",
      { availableFrom: from.toISOString(), availableUntil: until.toISOString() },
    );
  }
}
