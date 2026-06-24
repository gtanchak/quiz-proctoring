import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers/app.js";
import { pool } from "../src/db/client.js";
import { setEmailSender } from "../src/lib/email.js";
import { CapturingEmailSender } from "./helpers/email.js";
import { cleanupOrgs } from "./helpers/seed.js";

const PASSWORD = "correct-horse-battery-staple";
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe("password reset (/v1/auth/*-password)", () => {
  let app: TestApp;
  const mail = new CapturingEmailSender();
  const orgIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    setEmailSender(mail);
  });

  afterAll(async () => {
    setEmailSender(null);
    await cleanupOrgs(orgIds);
    await app.close();
    await pool.end();
  });

  async function verifiedUser(email: string): Promise<void> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { orgName: `${email}-org`, email, name: "Owner", password: PASSWORD },
    });
    orgIds.push(res.json().org.id);
    await app.inject({
      method: "POST",
      url: "/v1/auth/verify-email",
      payload: { token: mail.lastToken() },
    });
  }

  it("always returns 202 (no account enumeration)", async () => {
    await verifiedUser("pr-exists@example.com");
    const existing = await app.inject({
      method: "POST",
      url: "/v1/auth/request-password-reset",
      payload: { email: "pr-exists@example.com" },
    });
    expect(existing.statusCode).toBe(202);

    const missing = await app.inject({
      method: "POST",
      url: "/v1/auth/request-password-reset",
      payload: { email: "pr-nobody@example.com" },
    });
    expect(missing.statusCode).toBe(202);
  });

  it("resets the password, revokes sessions, and burns the token", async () => {
    const email = "pr-flow@example.com";
    await verifiedUser(email);

    const session = (
      await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email, password: PASSWORD },
      })
    ).json().sessionToken as string;

    await app.inject({
      method: "POST",
      url: "/v1/auth/request-password-reset",
      payload: { email },
    });
    const token = mail.lastToken();

    const newPassword = "a-fresh-reset-passphrase";
    const reset = await app.inject({
      method: "POST",
      url: "/v1/auth/reset-password",
      payload: { token, password: newPassword },
    });
    expect(reset.statusCode).toBe(200);

    // Existing session was revoked by the reset.
    expect(
      (await app.inject({ method: "GET", url: "/v1/me", headers: bearer(session) })).statusCode,
    ).toBe(401);

    // New password logs in; old one does not.
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/login",
          payload: { email, password: newPassword },
        })
      ).statusCode,
    ).toBe(200);

    // The token is single-use.
    const reuse = await app.inject({
      method: "POST",
      url: "/v1/auth/reset-password",
      payload: { token, password: "yet-another-passphrase" },
    });
    expect(reuse.statusCode).toBe(400);
  });

  it("rejects an unknown reset token (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/reset-password",
      payload: { token: "reset_not-a-real-token", password: PASSWORD },
    });
    expect(res.statusCode).toBe(400);
  });
});
