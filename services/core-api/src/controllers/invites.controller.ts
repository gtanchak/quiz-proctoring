import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from "@nestjs/common";
import { Type } from "@sinclair/typebox";
import { and, asc, eq } from "drizzle-orm";
import { Auth } from "../auth/auth.decorator.js";
import type { RequestAuth } from "../auth/request-auth.js";
import { RequireWrite } from "../auth/roles.decorator.js";
import { db } from "../db/client.js";
import { testInvites, type TestInviteRow } from "../db/schema/tests.js";
import { AppError } from "../lib/errors.js";
import { findOrgTest } from "../lib/test-access.js";
import { validate } from "../lib/validate.js";

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
const InviteBody = Type.Object({ email: Type.String({ format: "email" }) });

/**
 * Manage the invite allow-list for invite-only tests (admin, owner-scoped).
 * Emails are normalised to lower case so the candidate-side check is
 * case-insensitive. Invites can be edited at any time, including on a published
 * test — they don't change the test's structure.
 */
@Controller("v1/tests/:testId/invites")
export class InvitesController {
  @Post()
  @RequireWrite()
  @HttpCode(201)
  async create(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
    @Body() body: unknown,
  ) {
    const { testId } = validate(TestIdParams, params);
    const { email: rawEmail } = validate(InviteBody, body);
    const test = await findOrgTest(testId, auth.orgId);
    const email = rawEmail.trim().toLowerCase();

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
    return serializeInvite(row);
  }

  @Get()
  async list(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
  ) {
    const { testId } = validate(TestIdParams, params);
    const test = await findOrgTest(testId, auth.orgId);
    const rows = await db
      .select()
      .from(testInvites)
      .where(eq(testInvites.testId, test.id))
      .orderBy(asc(testInvites.email));
    return rows.map(serializeInvite);
  }

  @Delete(":inviteId")
  @RequireWrite()
  @HttpCode(204)
  async remove(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
  ): Promise<void> {
    const { testId, inviteId } = validate(InviteParams, params);
    const test = await findOrgTest(testId, auth.orgId);
    const [row] = await db
      .delete(testInvites)
      .where(and(eq(testInvites.id, inviteId), eq(testInvites.testId, test.id)))
      .returning({ id: testInvites.id });
    if (!row) {
      throw AppError.notFound("Invite not found");
    }
  }
}
