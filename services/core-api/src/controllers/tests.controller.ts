import { randomBytes } from "node:crypto";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  type ProctoringRequirements,
  ProctoringRequirementsSchema,
} from "@proctoring/shared";
import { Type } from "@sinclair/typebox";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { Auth } from "../auth/auth.decorator.js";
import type { RequestAuth } from "../auth/request-auth.js";
import { RequireWrite } from "../auth/roles.decorator.js";
import { db } from "../db/client.js";
import { questions, tests, type TestRow } from "../db/schema/tests.js";
import { AppError } from "../lib/errors.js";
import { PaginationQuery } from "../lib/pagination.js";
import { assertTestMutable, findOrgTest } from "../lib/test-access.js";
import { validate } from "../lib/validate.js";

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
    proctoring: row.proctoring as ProctoringRequirements,
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
    proctoring: Type.Optional(ProctoringRequirementsSchema),
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
 * tenants. Mutations additionally require a write role (`@RequireWrite()`).
 */
@Controller("v1/tests")
export class TestsController {
  @Post()
  @RequireWrite()
  @HttpCode(201)
  async create(@Auth() auth: RequestAuth, @Body() rawBody: unknown) {
    const body = validate(CreateTestBody, rawBody);
    const from = body.availableFrom ? new Date(body.availableFrom) : undefined;
    const until = body.availableUntil
      ? new Date(body.availableUntil)
      : undefined;
    assertValidWindow(from ?? null, until ?? null);

    const [row] = await db
      .insert(tests)
      .values({
        orgId: auth.orgId,
        title: body.title,
        description: body.description,
        instructions: body.instructions,
        durationMinutes: body.durationMinutes,
        availableFrom: from,
        availableUntil: until,
        maxAttempts: body.maxAttempts,
        passMark: body.passMark,
        negativeMarking: body.negativeMarking,
        ...(body.proctoring && { proctoring: body.proctoring }),
        accessMode: body.accessMode,
        accessToken: generateAccessToken(),
      })
      .returning();
    return serializeTest(row);
  }

  @Get()
  async list(
    @Auth() auth: RequestAuth,
    @Query() rawQuery: Record<string, unknown>,
  ) {
    const { limit, offset, status, sort, order } = validate(
      ListTestsQuery,
      rawQuery,
    );
    const where = status
      ? and(eq(tests.orgId, auth.orgId), eq(tests.status, status))
      : eq(tests.orgId, auth.orgId);

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
  }

  @Get(":id")
  async get(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
  ) {
    const { id } = validate(IdParams, params);
    const row = await findOrgTest(id, auth.orgId);
    return serializeTest(row);
  }

  @Patch(":id")
  @RequireWrite()
  async update(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
    @Body() rawBody: unknown,
  ) {
    const { id } = validate(IdParams, params);
    const body = validate(UpdateTestBody, rawBody);
    const existing = await findOrgTest(id, auth.orgId);
    await assertTestMutable(existing);

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
        ...(body.proctoring !== undefined && { proctoring: body.proctoring }),
        ...(body.accessMode !== undefined && { accessMode: body.accessMode }),
        updatedAt: new Date(),
      })
      .where(eq(tests.id, existing.id))
      .returning();
    return serializeTest(row);
  }

  @Delete(":id")
  @RequireWrite()
  @HttpCode(204)
  async remove(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
  ): Promise<void> {
    const { id } = validate(IdParams, params);
    const existing = await findOrgTest(id, auth.orgId);
    await assertTestMutable(existing);
    await db.delete(tests).where(eq(tests.id, existing.id));
  }

  @Post(":id/publish")
  @RequireWrite()
  @HttpCode(200)
  async publish(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
  ) {
    const { id } = validate(IdParams, params);
    const test = await findOrgTest(id, auth.orgId);

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
  }

  @Post(":id/unpublish")
  @RequireWrite()
  @HttpCode(200)
  async unpublish(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
  ) {
    const { id } = validate(IdParams, params);
    const test = await findOrgTest(id, auth.orgId);
    await assertTestMutable(test);
    const [row] = await db
      .update(tests)
      .set({ status: "draft", updatedAt: new Date() })
      .where(eq(tests.id, test.id))
      .returning();
    return serializeTest(row);
  }
}

/** Rejects an availability window whose end is not after its start. */
function assertValidWindow(from: Date | null, until: Date | null): void {
  if (from && until && from.getTime() >= until.getTime()) {
    throw AppError.badRequest("available_until must be after available_from", {
      availableFrom: from.toISOString(),
      availableUntil: until.toISOString(),
    });
  }
}
