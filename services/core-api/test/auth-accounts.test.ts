import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers/app.js";
import { pool } from "../src/db/client.js";
import { setEmailSender } from "../src/lib/email.js";
import { CapturingEmailSender } from "./helpers/email.js";
import { cleanupOrgs } from "./helpers/seed.js";

const PASSWORD = "correct-horse-battery-staple";
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe("auth & accounts (/v1/auth)", () => {
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

  /** Signs up and returns the verification token (captured from the email). */
  async function signup(email: string): Promise<{ token: string; orgId: string; userId: string }> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { orgName: `${email}-org`, email, name: "Owner", password: PASSWORD },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    orgIds.push(body.org.id);
    return { token: mail.lastToken(), orgId: body.org.id, userId: body.user.id };
  }

  it("signs up an owner (201) with an unverified email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        orgName: "Acme",
        email: "aa-signup@example.com",
        name: "Owner",
        password: PASSWORD,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    orgIds.push(body.org.id);
    expect(body.user).toMatchObject({
      email: "aa-signup@example.com",
      role: "tenant_admin",
      emailVerifiedAt: null,
    });
    expect(body.user.passwordHash).toBeUndefined();
  });

  it("rejects a weak password (400) and a duplicate email (409)", async () => {
    const weak = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { orgName: "X", email: "aa-weak@example.com", name: "N", password: "short" },
    });
    expect(weak.statusCode).toBe(400);

    await signup("aa-dup@example.com");
    const dup = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { orgName: "Y", email: "aa-dup@example.com", name: "N", password: PASSWORD },
    });
    expect(dup.statusCode).toBe(409);
  });

  it("blocks login until the email is verified, then completes the flow", async () => {
    const email = "aa-flow@example.com";
    const { token } = await signup(email);

    const early = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email, password: PASSWORD },
    });
    expect(early.statusCode).toBe(403);

    const verify = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-email",
      payload: { token },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toEqual({ verified: true });

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    const session = login.json().sessionToken as string;
    expect(session.startsWith("sess_")).toBe(true);

    const me = await app.inject({ method: "GET", url: "/v1/me", headers: bearer(session) });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ actorType: "user", user: { email, role: "tenant_admin" } });

    const logout = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: bearer(session),
    });
    expect(logout.statusCode).toBe(204);

    const afterLogout = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: bearer(session),
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it("rejects bad credentials uniformly (401) and an invalid verify token (400)", async () => {
    const email = "aa-creds@example.com";
    const { token } = await signup(email);
    await app.inject({ method: "POST", url: "/v1/auth/verify-email", payload: { token } });

    const wrongPw = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email, password: "wrong-password-here" },
    });
    expect(wrongPw.statusCode).toBe(401);

    const unknown = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "aa-nobody@example.com", password: PASSWORD },
    });
    expect(unknown.statusCode).toBe(401);

    const badToken = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-email",
      payload: { token: "verify_not-a-real-token" },
    });
    expect(badToken.statusCode).toBe(400);
  });

  it("changes password (revoking other sessions) and gates on the current password", async () => {
    const email = "aa-change@example.com";
    const { token } = await signup(email);
    await app.inject({ method: "POST", url: "/v1/auth/verify-email", payload: { token } });

    const sessionA = (
      await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email, password: PASSWORD },
      })
    ).json().sessionToken as string;
    const sessionB = (
      await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email, password: PASSWORD },
      })
    ).json().sessionToken as string;

    const wrong = await app.inject({
      method: "POST",
      url: "/v1/auth/change-password",
      headers: bearer(sessionA),
      payload: { currentPassword: "nope-nope-nope", newPassword: "a-brand-new-passphrase" },
    });
    expect(wrong.statusCode).toBe(401);

    const newPassword = "a-brand-new-passphrase";
    const ok = await app.inject({
      method: "POST",
      url: "/v1/auth/change-password",
      headers: bearer(sessionA),
      payload: { currentPassword: PASSWORD, newPassword },
    });
    expect(ok.statusCode).toBe(200);

    // Session A (the changer) survives; session B is revoked.
    expect(
      (await app.inject({ method: "GET", url: "/v1/me", headers: bearer(sessionA) })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/v1/me", headers: bearer(sessionB) })).statusCode,
    ).toBe(401);

    // New password works; old no longer does.
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/login",
          payload: { email, password: newPassword },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/login",
          payload: { email, password: PASSWORD },
        })
      ).statusCode,
    ).toBe(401);
  });
});
