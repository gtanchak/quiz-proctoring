import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  ChangeRoleRequestSchema,
  CreateMemberRequestSchema,
  type TenantBranding,
  UpdateTenantBrandingRequestSchema,
} from "@proctoring/shared";
import { Type } from "@sinclair/typebox";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { Auth } from "../auth/auth.decorator.js";
import type { RequestAuth } from "../auth/request-auth.js";
import { Roles } from "../auth/roles.decorator.js";
import { TenantId } from "../auth/tenant.decorator.js";
import { config } from "../config.js";
import { db } from "../db/client.js";
import {
  organizations,
  passwordResetTokens,
  type UserRow,
  users,
} from "../db/schema/accounts.js";
import { AuditAction, recordAudit } from "../lib/audit.js";
import { buildInviteEmail, getEmailSender } from "../lib/email.js";
import { AppError } from "../lib/errors.js";
import { hashPassword } from "../lib/password.js";
import { serializeUser } from "../lib/serialize-account.js";
import { revokeAllUserSessions } from "../lib/session.js";
import { TOKEN_TAGS, generateToken } from "../lib/token.js";
import { validate } from "../lib/validate.js";

const UserIdParams = Type.Object({ userId: Type.String({ format: "uuid" }) });

/**
 * Organization member management (PRO-39). Listing is open to any authenticated
 * org member; mutations are owner-only (`@Roles("tenant_admin")`). These routes sit
 * under `/v1/org/*` and are authenticated by the global guard.
 *
 * Invited members set their *own* password via an emailed link (we never
 * provision credentials on their behalf — PRO-39). The tenant admin only grants the
 * seat and role.
 */
@Controller("v1/org")
export class OrgController {
  @Get("users")
  async listUsers(@Auth() auth: RequestAuth) {
    const rows = await db
      .select()
      .from(users)
      .where(and(eq(users.orgId, auth.orgId), isNull(users.deletedAt)))
      .orderBy(asc(users.createdAt));
    return rows.map(serializeUser);
  }

  @Post("users")
  @Roles("tenant_admin")
  @HttpCode(201)
  async createUser(@Auth() auth: RequestAuth, @Body() body: unknown) {
    const dto = validate(CreateMemberRequestSchema, body);
    const email = dto.email.trim().toLowerCase();

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
          name: dto.name,
          role: dto.role,
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
    await getEmailSender().send(
      buildInviteEmail(email, org?.name ?? "your organization", token),
    );
    recordAudit({
      orgId: auth.orgId,
      actorType: auth.actorType,
      actorUserId: auth.userId,
      action: AuditAction.USER_CREATED,
      targetType: "user",
      targetId: user.id,
    });

    return serializeUser(user);
  }

  @Patch("users/:userId/role")
  @Roles("tenant_admin")
  async changeRole(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
    @Body() body: unknown,
  ) {
    const { userId } = validate(UserIdParams, params);
    const dto = validate(ChangeRoleRequestSchema, body);
    const target = await findOrgUser(userId, auth.orgId);
    if (target.role === "tenant_admin") {
      throw AppError.badRequest("The tenant admin's role cannot be changed");
    }
    const [updated] = await db
      .update(users)
      .set({ role: dto.role, updatedAt: new Date() })
      .where(eq(users.id, target.id))
      .returning();
    recordAudit({
      orgId: auth.orgId,
      actorType: auth.actorType,
      actorUserId: auth.userId,
      action: AuditAction.USER_ROLE_CHANGED,
      targetType: "user",
      targetId: target.id,
      metadata: { from: target.role, to: dto.role },
    });
    return serializeUser(updated);
  }

  @Delete("users/:userId")
  @Roles("tenant_admin")
  @HttpCode(204)
  async removeUser(
    @Auth() auth: RequestAuth,
    @Param() params: Record<string, string>,
  ): Promise<void> {
    const { userId } = validate(UserIdParams, params);
    const target = await findOrgUser(userId, auth.orgId);
    if (target.role === "tenant_admin") {
      throw AppError.badRequest("The tenant admin cannot be removed");
    }
    // Soft delete and revoke their sessions so access ends immediately.
    await db
      .update(users)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, target.id));
    await revokeAllUserSessions(target.id);
    recordAudit({
      orgId: auth.orgId,
      actorType: auth.actorType,
      actorUserId: auth.userId,
      action: AuditAction.USER_REMOVED,
      targetType: "user",
      targetId: target.id,
    });
  }

  @Get("branding")
  async getBranding(@TenantId() tenantId: string): Promise<TenantBranding> {
    const [row] = await db
      .select({
        logoUrl: organizations.logoUrl,
        primaryColor: organizations.primaryColor,
        subdomain: organizations.subdomain,
      })
      .from(organizations)
      .where(eq(organizations.id, tenantId))
      .limit(1);
    if (!row) {
      throw AppError.notFound("Tenant not found");
    }
    return row;
  }

  @Patch("branding")
  @Roles("tenant_admin")
  async updateBranding(
    @TenantId() tenantId: string,
    @Body() body: unknown,
  ): Promise<TenantBranding> {
    const dto = validate(UpdateTenantBrandingRequestSchema, body);

    // A non-null subdomain must be unique across tenants (the DB unique index is
    // the hard guarantee; this pre-check turns the race-free common case into a
    // friendly 409 rather than a constraint violation).
    if (dto.subdomain) {
      const [taken] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(
          and(
            eq(organizations.subdomain, dto.subdomain),
            ne(organizations.id, tenantId),
          ),
        )
        .limit(1);
      if (taken) {
        throw AppError.conflict("Subdomain is already taken");
      }
    }

    const [row] = await db
      .update(organizations)
      .set({
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
        ...(dto.primaryColor !== undefined && { primaryColor: dto.primaryColor }),
        ...(dto.subdomain !== undefined && { subdomain: dto.subdomain }),
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, tenantId))
      .returning({
        logoUrl: organizations.logoUrl,
        primaryColor: organizations.primaryColor,
        subdomain: organizations.subdomain,
      });
    return row;
  }
}

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
