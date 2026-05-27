import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { attempts, tests, type TestRow } from "../../db/schema/tests.js";
import { AppError } from "../../lib/errors.js";
import { PaginationQuery, paginated } from "../../lib/pagination.js";
import { AttemptEntity, serializeAttempt } from "./attempts.js";

const TestStatus = Type.Union([
  Type.Literal("draft"),
  Type.Literal("published"),
  Type.Literal("archived"),
]);

const TestEntity = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    title: Type.String(),
    description: Type.Union([Type.String(), Type.Null()]),
    status: TestStatus,
    durationSeconds: Type.Union([Type.Integer(), Type.Null()]),
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
    status: row.status,
    durationSeconds: row.durationSeconds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const CreateTestBody = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  status: Type.Optional(TestStatus),
  durationSeconds: Type.Optional(Type.Integer({ minimum: 1 })),
});

const UpdateTestBody = Type.Partial(CreateTestBody);

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
 * Tests CRUD + nested attempts listing. Every row is scoped to the calling API
 * key (`ownerKeyId`), so one tenant can never see or mutate another's tests —
 * a missing or unowned row returns 404, never 403, to avoid leaking existence.
 */
export const testsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    "/tests",
    {
      schema: {
        tags: ["tests"],
        summary: "Create a test",
        security: [{ bearerAuth: [] }],
        body: CreateTestBody,
        response: { 201: TestEntity, 400: Type.Ref("ErrorResponse") },
      },
    },
    async (request, reply) => {
      const [row] = await db
        .insert(tests)
        .values({ ownerKeyId: request.apiKey!.id, ...request.body })
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
        ? and(eq(tests.ownerKeyId, request.apiKey!.id), eq(tests.status, status))
        : eq(tests.ownerKeyId, request.apiKey!.id);

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
      const row = await findOwnedTest(request.params.id, request.apiKey!.id);
      return serializeTest(row);
    },
  );

  app.patch(
    "/tests/:id",
    {
      schema: {
        tags: ["tests"],
        summary: "Update a test",
        security: [{ bearerAuth: [] }],
        params: IdParams,
        body: UpdateTestBody,
        response: {
          200: TestEntity,
          400: Type.Ref("ErrorResponse"),
          404: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      await findOwnedTest(request.params.id, request.apiKey!.id);
      const [row] = await db
        .update(tests)
        .set({ ...request.body, updatedAt: new Date() })
        .where(eq(tests.id, request.params.id))
        .returning();
      return serializeTest(row);
    },
  );

  app.delete(
    "/tests/:id",
    {
      schema: {
        tags: ["tests"],
        summary: "Delete a test",
        security: [{ bearerAuth: [] }],
        params: IdParams,
        response: { 204: Type.Null(), 404: Type.Ref("ErrorResponse") },
      },
    },
    async (request, reply) => {
      await findOwnedTest(request.params.id, request.apiKey!.id);
      await db.delete(tests).where(eq(tests.id, request.params.id));
      reply.status(204);
      return null;
    },
  );

  app.get(
    "/tests/:id/attempts",
    {
      schema: {
        tags: ["attempts"],
        summary: "List attempts for a test",
        security: [{ bearerAuth: [] }],
        params: IdParams,
        querystring: PaginationQuery,
        response: {
          200: paginated(AttemptEntity),
          404: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      await findOwnedTest(request.params.id, request.apiKey!.id);
      const { limit, offset } = request.query;
      const where = eq(attempts.testId, request.params.id);

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
        data: rows.map(serializeAttempt),
        pagination: { total, limit, offset },
      };
    },
  );
};

/** Loads a test owned by the given key, or throws 404. */
async function findOwnedTest(id: string, ownerKeyId: string): Promise<TestRow> {
  const [row] = await db
    .select()
    .from(tests)
    .where(and(eq(tests.id, id), eq(tests.ownerKeyId, ownerKeyId)))
    .limit(1);
  if (!row) {
    throw AppError.notFound("Test not found");
  }
  return row;
}
