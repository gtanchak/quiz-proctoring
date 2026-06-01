import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";

/**
 * Email delivery abstraction (PRO-39).
 *
 * Real delivery (AWS SES) lands with PRO-38. Until then `LoggingEmailSender`
 * logs the message in development so verify/reset links can be followed
 * locally. CLAUDE.md §6 forbids logging PII/secret links in production, so the
 * stub refuses to log bodies there and emits a loud warning that mail was not
 * sent — surfacing the missing infrastructure rather than silently dropping it.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

/**
 * Process-wide override for the email sender. Defaults to the logging stub;
 * tests install a capturing sender via `setEmailSender` to assert on the
 * verify/reset link. When unset, `getEmailSender` builds a request-scoped
 * `LoggingEmailSender` so logs carry the request context.
 */
let overrideSender: EmailSender | null = null;

export function setEmailSender(sender: EmailSender | null): void {
  overrideSender = sender;
}

export function getEmailSender(log: FastifyBaseLogger): EmailSender {
  return overrideSender ?? new LoggingEmailSender(log);
}

export class LoggingEmailSender implements EmailSender {
  constructor(private readonly log: FastifyBaseLogger) {}

  async send(msg: EmailMessage): Promise<void> {
    if (config.NODE_ENV === "production") {
      this.log.warn(
        { to: msg.to, subject: msg.subject },
        "LoggingEmailSender active in production — email NOT sent (SES not yet wired; see PRO-38)",
      );
      return;
    }
    // Dev/test only: the link in `text` is intentionally logged so it can be followed.
    this.log.info({ to: msg.to, subject: msg.subject, body: msg.text }, "email (dev stub)");
  }
}

export function buildVerifyEmail(to: string, token: string): EmailMessage {
  const link = `${config.APP_BASE_URL}/verify-email?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: "Verify your email",
    text: `Confirm your email to activate your account:\n\n${link}\n\nThis link expires soon. If you didn't create an account, ignore this email.`,
  };
}

export function buildInviteEmail(
  to: string,
  orgName: string,
  token: string,
): EmailMessage {
  const link = `${config.APP_BASE_URL}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: `You've been invited to ${orgName}`,
    text: `You've been added to ${orgName} on the proctoring platform. Set your password to activate your account:\n\n${link}\n\nThis link expires soon.`,
  };
}

export function buildResetEmail(to: string, token: string): EmailMessage {
  const link = `${config.APP_BASE_URL}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: "Reset your password",
    text: `A password reset was requested for your account:\n\n${link}\n\nIf you didn't request this, you can safely ignore this email.`,
  };
}
