import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { pool } from "../src/db/client.js";
import { setEmailSender } from "../src/lib/email.js";
import { CapturingEmailSender } from "./helpers/email.js";
import { cleanupOrgs } from "./helpers/seed.js";

const PASSWORD = "correct-horse-battery-staple";

describe("resend email verification (/v1/auth/request-verification)", () => {
  let app: FastifyInstance;
  const mail = new CapturingEmailSender();
  const orgIds: string[] = [];

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    setEmailSender(mail);
  });

  afterAll(async () => {
    setEmailSender(null);
    await cleanupOrgs(orgIds);
    await app.close();
    await pool.end();
  });

  /** Signs up (unverified) and returns the email. */
  async function signup(email: string): Promise<void> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { orgName: `${email}-org`, email, name: "Owner", password: PASSWORD },
    });
    orgIds.push(res.json().org.id);
  }

  const requestVerification = (email: string) =>
    app.inject({
      method: "POST",
      url: "/v1/auth/request-verification",
      payload: { email },
    });

  it("re-issues a working link for an unverified account, enabling login", async () => {
    const email = "rv-flow@example.com";
    await signup(email); // unverified; login is gated

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/login",
          payload: { email, password: PASSWORD },
        })
      ).statusCode,
    ).toBe(403); // "Email not verified"

    const before = mail.messages.length;
    const res = await requestVerification(email);
    expect(res.statusCode).toBe(202);
    expect(mail.messages.length).toBe(before + 1); // a fresh email went out

    const verified = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-email",
      payload: { token: mail.lastToken() },
    });
    expect(verified.statusCode).toBe(200);

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/login",
          payload: { email, password: PASSWORD },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("issues nothing for an already-verified account (still 202)", async () => {
    const email = "rv-already@example.com";
    await signup(email);
    await app.inject({
      method: "POST",
      url: "/v1/auth/verify-email",
      payload: { token: mail.lastToken() },
    });

    const before = mail.messages.length;
    const res = await requestVerification(email);
    expect(res.statusCode).toBe(202);
    expect(mail.messages.length).toBe(before); // no new email
  });

  it("returns 202 for an unknown email and sends nothing (no enumeration)", async () => {
    const before = mail.messages.length;
    const res = await requestVerification("rv-nobody@example.com");
    expect(res.statusCode).toBe(202);
    expect(mail.messages.length).toBe(before);
  });
});
