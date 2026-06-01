import {
  ChangeRoleRequestSchema,
  CreateMemberRequestSchema,
  UserDtoSchema,
} from "@proctoring/shared";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { and, asc, eq, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { config } from "../../config.js";
import { db } from "../../db/client.js";
import {
  organizations,
  passwordResetTokens,
  type UserRow,
  users,
} from "../../db/schema/accounts.js";
import { AuditAction, recordAudit } from "../../lib/audit.js";
import { requireRole } from "../../lib/authz.js";
import { buildInviteEmail, getEmailSender } from "../../lib/email.js";
import { AppError } from "../../lib/errors.js";
import { hashPassword } from "../../lib/password.js";
import { revokeAllUserSessions } from "../../lib/session.js";
import { serializeUser } from "../../lib/serialize-account.js";
import { TOKEN_TAGS, generateToken } from "../../lib/token.js";

/**
 * Organization member management (PRO-39). Listing is open to any authenticated
 * org member; mutations are owner-only (`requireRole("owner")`). These routes
 * sit under `/v1/org/*` and are authenticated by the global hook, so
 * `request.auth` is always set.
 *
 * Invited members set their *own* password via an emailed link (we never
 * provision credentials on their behalf — CLAUDE.md / PRO-39). The owner only
 * grants the seat and role.
 */
const UserIdParams = Type.Object({ userId: Type.String({ format: "uuid" }) });

/** Loads a non-deleted user in the given org, or 404 (never leak cross-org). */
async function findOrgUser(userId: string, orgId: string): Promise<UserRow> {
  const [row] = await db
    .select()
    .from(users)
    .where(
      and(eq(users.id, userId), eq(users.orgId, orgId), isNull(users.deletedAt)),
    )
    .limit(1);
  if (!row) {
    throw AppError.notFound("User not found");
  }
  return row;
}

export const orgRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/org/users",
    {
      schema: {
        tags: ["org"],
        summary: "List members of the organization",
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Array(UserDtoSchema),
          401: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      const rows = await db
        .select()
        .from(users)
        .where(and(eq(users.orgId, request.auth!.orgId), isNull(users.deletedAt)))
        .orderBy(asc(users.createdAt));
      return rows.map(serializeUser);
    },
  );

  app.post(
    "/org/users",
    {
      preHandler: requireRole("owner"),
      schema: {
        tags: ["org"],
        summary: "Invite a member (they set their own password via email)",
        security: [{ bearerAuth: [] }],
        body: CreateMemberRequestSchema,
        response: {
          201: UserDtoSchema,
          401: Type.Ref("ErrorResponse"),
          403: Type.Ref("ErrorResponse"),
          409: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const email = request.body.email.trim().toLowerCase();

      const { token, prefix, hash } = generateToken(TOKEN_TAGS.passwordReset);
      const user = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (existing) {
          throw AppError.conflict("An account with this email already exists");
        }
        const [created] = await tx
          .insert(users)
          .values({
            orgId: auth.orgId,
            email,
            name: request.body.name,
            role: request.body.role,
            // Unusable placeholder — the member sets a real password via the link.
            passwordHash: hashPassword(randomBytes(24).toString("base64url")),
          })
          .returning();
        await tx.insert(passwordResetTokens).values({
          userId: created.id,
          tokenHash: hash,
          tokenPrefix: prefix,
          expiresAt: new Date(Date.now() + config.PASSWORD_RESET_TTL * 1000),
        });
        return created;
      });

      const [org] = await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, auth.orgId))
        .limit(1);
      await getEmailSender(request.log).send(
        buildInviteEmail(email, org?.name ?? "your organization", token),
      );
      recordAudit(request.log, {
        orgId: auth.orgId,
        actorType: auth.actorType,
        actorUserId: auth.userId,
        action: AuditAction.USER_CREATED,
        targetType: "user",
        targetId: user.id,
      });

      reply.status(201);
      return serializeUser(user);
    },
  );

  app.patch(
    "/org/users/:userId/role",
    {
      preHandler: requireRole("owner"),
      schema: {
        tags: ["org"],
        summary: "Change a member's role (admin/viewer)",
        security: [{ bearerAuth: [] }],
        params: UserIdParams,
        body: ChangeRoleRequestSchema,
        response: {
          200: UserDtoSchema,
          400: Type.Ref("ErrorResponse"),
          401: Type.Ref("ErrorResponse"),
          403: Type.Ref("ErrorResponse"),
          404: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      const auth = request.auth!;
      const target = await findOrgUser(request.params.userId, auth.orgId);
      if (target.role === "owner") {
        throw AppError.badRequest("The owner's role cannot be changed");
      }
      const [updated] = await db
        .update(users)
        .set({ role: request.body.role, updatedAt: new Date() })
        .where(eq(users.id, target.id))
        .returning();
      recordAudit(request.log, {
        orgId: auth.orgId,
        actorType: auth.actorType,
        actorUserId: auth.userId,
        action: AuditAction.USER_ROLE_CHANGED,
        targetType: "user",
        targetId: target.id,
        metadata: { from: target.role, to: request.body.role },
      });
      return serializeUser(updated);
    },
  );

  app.delete(
    "/org/users/:userId",
    {
      preHandler: requireRole("owner"),
      schema: {
        tags: ["org"],
        summary: "Remove a member from the organization",
        security: [{ bearerAuth: [] }],
        params: UserIdParams,
        response: {
          204: Type.Null(),
          400: Type.Ref("ErrorResponse"),
          401: Type.Ref("ErrorResponse"),
          403: Type.Ref("ErrorResponse"),
          404: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const target = await findOrgUser(request.params.userId, auth.orgId);
      if (target.role === "owner") {
        throw AppError.badRequest("The owner cannot be removed");
      }
      // Soft delete and revoke their sessions so access ends immediately.
      await db
        .update(users)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, target.id));
      await revokeAllUserSessions(target.id);
      recordAudit(request.log, {
        orgId: auth.orgId,
        actorType: auth.actorType,
        actorUserId: auth.userId,
        action: AuditAction.USER_REMOVED,
        targetType: "user",
        targetId: target.id,
      });
      reply.status(204);
      return null;
    },
  );
};
