import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  type LoginResponse,
  RequestEmailVerificationRequestSchema,
  RequestPasswordResetRequestSchema,
  ResetPasswordRequestSchema,
  SignupRequestSchema,
  type SignupResponse,
  UpdateProfileRequestSchema,
  VerifyEmailRequestSchema,
} from "@proctoring/shared";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { Request } from "express";
import { Req } from "@nestjs/common";
import { Auth } from "../auth/auth.decorator.js";
import type { RequestAuth } from "../auth/request-auth.js";
import { SessionGuard } from "../auth/session.guard.js";
import { config } from "../config.js";
import { db } from "../db/client.js";
import {
  emailVerificationTokens,
  organizations,
  passwordResetTokens,
  sessions,
  users,
} from "../db/schema/accounts.js";
import { AuditAction, recordAudit } from "../lib/audit.js";
import {
  buildResetEmail,
  buildVerifyEmail,
  getEmailSender,
} from "../lib/email.js";
import { AppError } from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { serializeOrg, serializeUser } from "../lib/serialize-account.js";
import {
  createSession,
  revokeAllUserSessions,
  revokeSession,
} from "../lib/session.js";
import {
  TOKEN_TAGS,
  generateToken,
  hashToken,
  tokenHashesMatch,
  tokenPrefix,
} from "../lib/token.js";
import { validate } from "../lib/validate.js";

/** A stable, unusable password hash so timing is equal when the email is unknown. */
let dummyHash: string | null = null;
function dummyPasswordHash(): string {
  dummyHash ??= hashPassword("timing-equalizer-not-a-real-password");
  return dummyHash;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Authentication & account routes (PRO-39): signup → email verification →
 * login → logout, password reset, change password, and profile.
 *
 * These live under `/v1/auth/*`, which the global {@link AuthGuard} deliberately
 * skips — the open endpoints take no credential, and the protected ones
 * self-authenticate via {@link SessionGuard}. Candidates never touch these
 * routes; they take open-link tests with no account.
 */
@Controller("v1/auth")
export class AuthController {
  @Post("signup")
  @HttpCode(201)
  async signup(@Body() body: unknown): Promise<SignupResponse> {
    const dto = validate(SignupRequestSchema, body);
    const email = normalizeEmail(dto.email);

    const { token, prefix, hash } = generateToken(TOKEN_TAGS.emailVerification);
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (existing) {
        throw AppError.conflict("An account with this email already exists");
      }
      const [org] = await tx
        .insert(organizations)
        .values({ name: dto.orgName })
        .returning();
      const [user] = await tx
        .insert(users)
        .values({
          orgId: org.id,
          email,
          name: dto.name,
          role: "tenant_admin",
          passwordHash: hashPassword(dto.password),
        })
        .returning();
      await tx.insert(emailVerificationTokens).values({
        userId: user.id,
        tokenHash: hash,
        tokenPrefix: prefix,
        expiresAt: new Date(Date.now() + config.EMAIL_VERIFICATION_TTL * 1000),
      });
      return { org, user };
    });

    await getEmailSender().send(buildVerifyEmail(email, token));
    recordAudit({
      orgId: result.org.id,
      actorType: "user",
      actorUserId: result.user.id,
      action: AuditAction.ORG_CREATED,
    });
    recordAudit({
      orgId: result.org.id,
      actorType: "user",
      actorUserId: result.user.id,
      action: AuditAction.USER_CREATED,
      targetType: "user",
      targetId: result.user.id,
    });

    return { user: serializeUser(result.user), org: serializeOrg(result.org) };
  }

  @Post("verify-email")
  @HttpCode(200)
  async verifyEmail(@Body() body: unknown) {
    const { token } = validate(VerifyEmailRequestSchema, body);
    const [row] = await db
      .select({ t: emailVerificationTokens, u: users })
      .from(emailVerificationTokens)
      .innerJoin(users, eq(emailVerificationTokens.userId, users.id))
      .where(eq(emailVerificationTokens.tokenPrefix, tokenPrefix(token)))
      .limit(1);
    if (
      !row ||
      !tokenHashesMatch(row.t.tokenHash, hashToken(token)) ||
      row.t.usedAt ||
      row.t.expiresAt.getTime() <= Date.now()
    ) {
      throw AppError.badRequest("Invalid or expired verification token");
    }

    // Idempotent: marking an already-verified user verified again is a no-op.
    await db.transaction(async (tx) => {
      await tx
        .update(emailVerificationTokens)
        .set({ usedAt: new Date() })
        .where(eq(emailVerificationTokens.id, row.t.id));
      if (!row.u.emailVerifiedAt) {
        await tx
          .update(users)
          .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
          .where(eq(users.id, row.u.id));
      }
    });

    if (!row.u.emailVerifiedAt) {
      recordAudit({
        orgId: row.u.orgId,
        actorType: "user",
        actorUserId: row.u.id,
        action: AuditAction.USER_EMAIL_VERIFIED,
      });
    }
    return { verified: true };
  }

  @Post("request-verification")
  @HttpCode(202)
  async requestVerification(@Body() body: unknown) {
    const { email: rawEmail } = validate(
      RequestEmailVerificationRequestSchema,
      body,
    );
    const email = normalizeEmail(rawEmail);
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // Always 202 regardless — no enumeration. Only issue a token for an
    // existing, non-deleted, still-unverified account (re-verifying is moot).
    if (user && !user.deletedAt && !user.emailVerifiedAt) {
      const { token, prefix, hash } = generateToken(
        TOKEN_TAGS.emailVerification,
      );
      await db.insert(emailVerificationTokens).values({
        userId: user.id,
        tokenHash: hash,
        tokenPrefix: prefix,
        expiresAt: new Date(Date.now() + config.EMAIL_VERIFICATION_TTL * 1000),
      });
      await getEmailSender().send(buildVerifyEmail(email, token));
      recordAudit({
        orgId: user.orgId,
        actorType: "user",
        actorUserId: user.id,
        action: AuditAction.USER_EMAIL_VERIFICATION_REQUESTED,
      });
    }
    return { ok: true };
  }

  @Post("login")
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<LoginResponse> {
    const dto = validate(LoginRequestSchema, body);
    const email = normalizeEmail(dto.email);
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user || user.deletedAt) {
      // Run a hash to keep timing comparable to the real path, then fail uniformly.
      verifyPassword(dto.password, dummyPasswordHash());
      throw AppError.unauthorized("Invalid email or password");
    }
    if (!verifyPassword(dto.password, user.passwordHash)) {
      throw AppError.unauthorized("Invalid email or password");
    }
    if (!user.emailVerifiedAt) {
      throw AppError.forbidden("Email not verified");
    }

    const session = await createSession(user.id, {
      userAgent: req.headers["user-agent"] ?? null,
      ip: req.ip ?? null,
    });
    recordAudit({
      orgId: user.orgId,
      actorType: "user",
      actorUserId: user.id,
      action: AuditAction.USER_LOGIN,
    });
    return {
      user: serializeUser(user),
      sessionToken: session.token,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  @Post("logout")
  @UseGuards(SessionGuard)
  @HttpCode(204)
  async logout(@Auth() auth: RequestAuth): Promise<void> {
    await revokeSession(auth.sessionId!);
    recordAudit({
      orgId: auth.orgId,
      actorType: "user",
      actorUserId: auth.userId,
      action: AuditAction.USER_LOGOUT,
    });
  }

  @Post("request-password-reset")
  @HttpCode(202)
  async requestPasswordReset(@Body() body: unknown) {
    const { email: rawEmail } = validate(
      RequestPasswordResetRequestSchema,
      body,
    );
    const email = normalizeEmail(rawEmail);
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // Always 202 regardless of whether the account exists — no enumeration.
    if (user && !user.deletedAt) {
      const { token, prefix, hash } = generateToken(TOKEN_TAGS.passwordReset);
      await db.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash: hash,
        tokenPrefix: prefix,
        expiresAt: new Date(Date.now() + config.PASSWORD_RESET_TTL * 1000),
      });
      await getEmailSender().send(buildResetEmail(email, token));
      recordAudit({
        orgId: user.orgId,
        actorType: "user",
        actorUserId: user.id,
        action: AuditAction.USER_PASSWORD_RESET_REQUESTED,
      });
    }
    return { ok: true };
  }

  @Post("reset-password")
  @HttpCode(200)
  async resetPassword(@Body() body: unknown) {
    const { token, password } = validate(ResetPasswordRequestSchema, body);
    const [row] = await db
      .select({ t: passwordResetTokens, u: users })
      .from(passwordResetTokens)
      .innerJoin(users, eq(passwordResetTokens.userId, users.id))
      .where(eq(passwordResetTokens.tokenPrefix, tokenPrefix(token)))
      .limit(1);
    if (
      !row ||
      !tokenHashesMatch(row.t.tokenHash, hashToken(token)) ||
      row.t.usedAt ||
      row.t.expiresAt.getTime() <= Date.now() ||
      row.u.deletedAt
    ) {
      throw AppError.badRequest("Invalid or expired reset token");
    }

    await db.transaction(async (tx) => {
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, row.t.id));
      await tx
        .update(users)
        .set({
          passwordHash: hashPassword(password),
          // Completing an emailed reset proves email ownership — verify if not
          // already. This also activates invited members (see /org/users).
          ...(row.u.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }),
          updatedAt: new Date(),
        })
        .where(eq(users.id, row.u.id));
    });
    // A password change invalidates every existing session.
    await revokeAllUserSessions(row.u.id);
    recordAudit({
      orgId: row.u.orgId,
      actorType: "user",
      actorUserId: row.u.id,
      action: AuditAction.USER_PASSWORD_RESET,
    });
    return { reset: true };
  }

  @Post("change-password")
  @UseGuards(SessionGuard)
  @HttpCode(200)
  async changePassword(@Auth() auth: RequestAuth, @Body() body: unknown) {
    const dto = validate(ChangePasswordRequestSchema, body);
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, auth.userId!))
      .limit(1);
    if (!user) {
      throw AppError.unauthorized();
    }
    if (!verifyPassword(dto.currentPassword, user.passwordHash)) {
      throw AppError.unauthorized("Current password is incorrect");
    }
    await db
      .update(users)
      .set({
        passwordHash: hashPassword(dto.newPassword),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    // Revoke other sessions; keep the one making this change.
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(sessions.userId, user.id),
          isNull(sessions.revokedAt),
          ne(sessions.id, auth.sessionId!),
        ),
      );
    recordAudit({
      orgId: user.orgId,
      actorType: "user",
      actorUserId: user.id,
      action: AuditAction.USER_PASSWORD_CHANGED,
    });
    return { changed: true };
  }

  @Get("profile")
  @UseGuards(SessionGuard)
  async getProfile(@Auth() auth: RequestAuth) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, auth.userId!))
      .limit(1);
    if (!user) {
      throw AppError.unauthorized();
    }
    return serializeUser(user);
  }

  @Patch("profile")
  @UseGuards(SessionGuard)
  async updateProfile(@Auth() auth: RequestAuth, @Body() body: unknown) {
    const dto = validate(UpdateProfileRequestSchema, body);
    const [user] = await db
      .update(users)
      .set({ name: dto.name, updatedAt: new Date() })
      .where(eq(users.id, auth.userId!))
      .returning();
    if (!user) {
      throw AppError.unauthorized();
    }
    return serializeUser(user);
  }
}
