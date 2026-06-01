import type { EmailMessage, EmailSender } from "../../src/lib/email.js";

/**
 * Test email sender that captures messages instead of sending, so tests can
 * assert on (and extract the token from) verification/reset/invite links.
 * Install with `setEmailSender(new CapturingEmailSender())`.
 */
export class CapturingEmailSender implements EmailSender {
  readonly messages: EmailMessage[] = [];

  async send(msg: EmailMessage): Promise<void> {
    this.messages.push(msg);
  }

  last(): EmailMessage | undefined {
    return this.messages.at(-1);
  }

  /** The `token` query param from the most recent email's link. */
  lastToken(): string {
    const text = this.last()?.text ?? "";
    const match = text.match(/[?&]token=([^\s&]+)/);
    if (!match) {
      throw new Error("No token found in the last captured email");
    }
    return decodeURIComponent(match[1]);
  }
}
