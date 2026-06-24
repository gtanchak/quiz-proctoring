import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import {
  type ProvisionTenantResponse,
  ProvisionTenantRequestSchema,
  type TenantSummaryDto,
} from "@proctoring/shared";
import { randomBytes } from "node:crypto";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { Auth } from "../auth/auth.decorator.js";
import type { RequestAuth } from "../auth/request-auth.js";
import { Roles } from "../auth/roles.decorator.js";
import { config } from "../config.js";
import { db } from "../db/client.js";
import {
  organizations,
  passwordResetTokens,
  users,
} from "../db/schema/accounts.js";
import { AuditAction, recordAudit } from "../lib/audit.js";
import { buildInviteEmail, getEmailSender } from "../lib/email.js";
import { AppError } from "../lib/errors.js";
import { hashPassword } from "../lib/password.js";
import { serializeOrg, serializeUser } from "../lib/serialize-account.js";
import { TOKEN_TAGS, generateToken } from "../lib/token.js";
import { validate } from "../lib/validate.js";

/**
 * Platform administration (PRO-57) — cross-tenant operations restricted to the
 * `platform_admin` super-admin. Provisions tenants and lists them. These routes
 * are deliberately NOT tenant-scoped: a platform admin acts across tenants, so
 * the tenant boundary (TenantGuard) does not constrain them here; the
 * `@Roles("platform_admin")` gate is the access control.
 */
@Controller("v1/platform")
export class PlatformController {
  @Post("tenants")
  @Roles("platform_admin")
  @HttpCode(201)
  async provisionTenant(
    @Auth() auth: RequestAuth,
    @Body() body: unknown,
  ): Promise<ProvisionTenantResponse> {
    const dto = validate(ProvisionTenantRequestSchema, body);
    const adminEmail = dto.adminEmail.trim().toLowerCase();

    const { token, prefix, hash } = generateToken(TOKEN_TAGS.passwordReset);
    const { org, admin } = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, adminEmail))
        .limit(1);
      if (existing) {
        throw AppError.conflict("An account with this email already exists");
      }
      const [createdOrg] = await tx
        .insert(organizations)
        .values({ name: dto.name })
        .returning();
      const [createdAdmin] = await tx
        .insert(users)
        .values({
          orgId: createdOrg.id,
          email: adminEmail,
          name: dto.adminName,
          role: "tenant_admin",
          // Unusable placeholder — the admin sets a real password via the link.
          passwordHash: hashPassword(randomBytes(24).toString("base64url")),
        })
        .returning();
      await tx.insert(passwordResetTokens).values({
        userId: createdAdmin.id,
        tokenHash: hash,
        tokenPrefix: prefix,
        expiresAt: new Date(Date.now() + config.PASSWORD_RESET_TTL * 1000),
      });
      return { org: createdOrg, admin: createdAdmin };
    });

    await getEmailSender().send(buildInviteEmail(adminEmail, org.name, token));
    recordAudit({
      orgId: org.id,
      actorType: auth.actorType,
      actorUserId: auth.userId,
      action: AuditAction.ORG_CREATED,
    });
    recordAudit({
      orgId: org.id,
      actorType: auth.actorType,
      actorUserId: auth.userId,
      action: AuditAction.USER_CREATED,
      targetType: "user",
      targetId: admin.id,
    });

    return { tenant: serializeOrg(org), admin: serializeUser(admin) };
  }

  @Get("tenants")
  @Roles("platform_admin")
  async listTenants(): Promise<TenantSummaryDto[]> {
    const rows = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        createdAt: organizations.createdAt,
        memberCount: count(users.id),
      })
      .from(organizations)
      .leftJoin(
        users,
        and(eq(users.orgId, organizations.id), isNull(users.deletedAt)),
      )
      .groupBy(organizations.id)
      .orderBy(asc(organizations.createdAt));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt.toISOString(),
      memberCount: r.memberCount,
    }));
  }
}
