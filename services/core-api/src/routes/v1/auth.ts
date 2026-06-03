import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  RequestEmailVerificationRequestSchema,
  RequestPasswordResetRequestSchema,
  ResetPasswordRequestSchema,
  SignupRequestSchema,
  SignupResponseSchema,
  UpdateProfileRequestSchema,
  UserDtoSchema,
  VerifyEmailRequestSchema,
} from "@proctoring/shared";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { and, eq, isNull, ne } from "drizzle-orm";
import { config } from "../../config.js";
import { db } from "../../db/client.js";
import {
  emailVerificationTokens,
  organizations,
  passwordResetTokens,
  sessions,
  users,
} from "../../db/schema/accounts.js";
import { AuditAction, recordAudit } from "../../lib/audit.js";
import { requireSession } from "../../lib/authz.js";
import {
  buildResetEmail,
  buildVerifyEmail,
  getEmailSender,
} from "../../lib/email.js";
import { AppError } from "../../lib/errors.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { serializeOrg, serializeUser } from "../../lib/serialize-account.js";
import {
  createSession,
  revokeAllUserSessions,
  revokeSession,
} from "../../lib/session.js";
import {
  TOKEN_TAGS,
  generateToken,
  hashToken,
  tokenHashesMatch,
  tokenPrefix,
} from "../../lib/token.js";

/**
 * Authentication & account routes (PRO-39): signup → email verification →
 * login → logout, password reset, change password, and profile.
 *
 * These live under `/v1/auth/*`, which the global auth hook (plugins/auth.ts)
 * deliberately skips — the open endpoints (signup/login/verify/reset) take no
 * credential, and the protected ones (logout/change-password/profile)
 * self-authenticate via the `requireSession` preHandler. Candidates never touch
 * these routes; they take open-link tests with no account.
 */

/** A stable, unusable password hash so timing is equal when the email is unknown. */
let dummyHash: string | null = null;
function dummyPasswordHash(): string {
  dummyHash ??= hashPassword("timing-equalizer-not-a-real-password");
  return dummyHash;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    "/auth/signup",
    {
      schema: {
        tags: ["auth"],
        summary: "Create an account (organization + owner user)",
        body: SignupRequestSchema,
        response: {
          201: SignupResponseSchema,
          400: Type.Ref("ErrorResponse"),
          409: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request, reply) => {
      const email = normalizeEmail(request.body.email);

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
          .values({ name: request.body.orgName })
          .returning();
        const [user] = await tx
          .insert(users)
          .values({
            orgId: org.id,
            email,
            name: request.body.name,
            role: "owner",
            passwordHash: hashPassword(request.body.password),
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

      await getEmailSender(request.log).send(
        buildVerifyEmail(email, token),
      );
      recordAudit(request.log, {
        orgId: result.org.id,
        actorType: "user",
        actorUserId: result.user.id,
        action: AuditAction.ORG_CREATED,
      });
      recordAudit(request.log, {
        orgId: result.org.id,
        actorType: "user",
        actorUserId: result.user.id,
        action: AuditAction.USER_CREATED,
        targetType: "user",
        targetId: result.user.id,
      });

      reply.status(201);
      return { user: serializeUser(result.user), org: serializeOrg(result.org) };
    },
  );

  app.post(
    "/auth/verify-email",
    {
      schema: {
        tags: ["auth"],
        summary: "Verify an email address with the emailed token",
        body: VerifyEmailRequestSchema,
        response: {
          200: Type.Object({ verified: Type.Boolean() }),
          400: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      const { token } = request.body;
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
        recordAudit(request.log, {
          orgId: row.u.orgId,
          actorType: "user",
          actorUserId: row.u.id,
          action: AuditAction.USER_EMAIL_VERIFIED,
        });
      }
      return { verified: true };
    },
  );

  app.post(
    "/auth/request-verification",
    {
      schema: {
        tags: ["auth"],
        summary: "Re-issue an email-verification link (always succeeds)",
        body: RequestEmailVerificationRequestSchema,
        response: { 202: Type.Object({ ok: Type.Boolean() }) },
      },
    },
    async (request, reply) => {
      const email = normalizeEmail(request.body.email);
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
        await getEmailSender(request.log).send(buildVerifyEmail(email, token));
        recordAudit(request.log, {
          orgId: user.orgId,
          actorType: "user",
          actorUserId: user.id,
          action: AuditAction.USER_EMAIL_VERIFICATION_REQUESTED,
        });
      }
      reply.status(202);
      return { ok: true };
    },
  );

  app.post(
    "/auth/login",
    {
      schema: {
        tags: ["auth"],
        summary: "Log in with email + password; returns a session token",
        body: LoginRequestSchema,
        response: {
          200: LoginResponseSchema,
          401: Type.Ref("ErrorResponse"),
          403: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      const email = normalizeEmail(request.body.email);
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (!user || user.deletedAt) {
        // Run a hash to keep timing comparable to the real path, then fail uniformly.
        verifyPassword(request.body.password, dummyPasswordHash());
        throw AppError.unauthorized("Invalid email or password");
      }
      if (!verifyPassword(request.body.password, user.passwordHash)) {
        throw AppError.unauthorized("Invalid email or password");
      }
      if (!user.emailVerifiedAt) {
        throw AppError.forbidden("Email not verified");
      }

      const session = await createSession(user.id, {
        userAgent: request.headers["user-agent"] ?? null,
        ip: request.ip,
      });
      recordAudit(request.log, {
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
    },
  );

  app.post(
    "/auth/logout",
    {
      preHandler: requireSession,
      schema: {
        tags: ["auth"],
        summary: "Revoke the current session",
        security: [{ bearerAuth: [] }],
        response: { 204: Type.Null(), 401: Type.Ref("ErrorResponse") },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      await revokeSession(auth.sessionId!);
      recordAudit(request.log, {
        orgId: auth.orgId,
        actorType: "user",
        actorUserId: auth.userId,
        action: AuditAction.USER_LOGOUT,
      });
      reply.status(204);
      return null;
    },
  );

  app.post(
    "/auth/request-password-reset",
    {
      schema: {
        tags: ["auth"],
        summary: "Request a password-reset link (always succeeds)",
        body: RequestPasswordResetRequestSchema,
        response: { 202: Type.Object({ ok: Type.Boolean() }) },
      },
    },
    async (request, reply) => {
      const email = normalizeEmail(request.body.email);
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
        await getEmailSender(request.log).send(
          buildResetEmail(email, token),
        );
        recordAudit(request.log, {
          orgId: user.orgId,
          actorType: "user",
          actorUserId: user.id,
          action: AuditAction.USER_PASSWORD_RESET_REQUESTED,
        });
      }
      reply.status(202);
      return { ok: true };
    },
  );

  app.post(
    "/auth/reset-password",
    {
      schema: {
        tags: ["auth"],
        summary: "Set a new password with the emailed reset token",
        body: ResetPasswordRequestSchema,
        response: {
          200: Type.Object({ reset: Type.Boolean() }),
          400: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      const { token, password } = request.body;
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
      recordAudit(request.log, {
        orgId: row.u.orgId,
        actorType: "user",
        actorUserId: row.u.id,
        action: AuditAction.USER_PASSWORD_RESET,
      });
      return { reset: true };
    },
  );

  app.post(
    "/auth/change-password",
    {
      preHandler: requireSession,
      schema: {
        tags: ["auth"],
        summary: "Change the current user's password",
        security: [{ bearerAuth: [] }],
        body: ChangePasswordRequestSchema,
        response: {
          200: Type.Object({ changed: Type.Boolean() }),
          400: Type.Ref("ErrorResponse"),
          401: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      const auth = request.auth!;
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, auth.userId!))
        .limit(1);
      if (!user) {
        throw AppError.unauthorized();
      }
      if (!verifyPassword(request.body.currentPassword, user.passwordHash)) {
        throw AppError.unauthorized("Current password is incorrect");
      }
      await db
        .update(users)
        .set({
          passwordHash: hashPassword(request.body.newPassword),
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
      recordAudit(request.log, {
        orgId: user.orgId,
        actorType: "user",
        actorUserId: user.id,
        action: AuditAction.USER_PASSWORD_CHANGED,
      });
      return { changed: true };
    },
  );

  app.get(
    "/auth/profile",
    {
      preHandler: requireSession,
      schema: {
        tags: ["auth"],
        summary: "The current user's profile",
        security: [{ bearerAuth: [] }],
        response: { 200: UserDtoSchema, 401: Type.Ref("ErrorResponse") },
      },
    },
    async (request) => {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, request.auth!.userId!))
        .limit(1);
      if (!user) {
        throw AppError.unauthorized();
      }
      return serializeUser(user);
    },
  );

  app.patch(
    "/auth/profile",
    {
      preHandler: requireSession,
      schema: {
        tags: ["auth"],
        summary: "Update the current user's display name",
        security: [{ bearerAuth: [] }],
        body: UpdateProfileRequestSchema,
        response: { 200: UserDtoSchema, 401: Type.Ref("ErrorResponse") },
      },
    },
    async (request) => {
      const [user] = await db
        .update(users)
        .set({ name: request.body.name, updatedAt: new Date() })
        .where(eq(users.id, request.auth!.userId!))
        .returning();
      if (!user) {
        throw AppError.unauthorized();
      }
      return serializeUser(user);
    },
  );
};
