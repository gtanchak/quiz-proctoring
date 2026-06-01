import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { db, pool } from "../src/db/client.js";
import { sessions } from "../src/db/schema/accounts.js";
import { setEmailSender } from "../src/lib/email.js";
import { CapturingEmailSender } from "./helpers/email.js";
import { cleanupOrgs } from "./helpers/seed.js";

const PASSWORD = "correct-horse-battery-staple";
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe("session expiry & revocation", () => {
  let app: FastifyInstance;
  const mail = new CapturingEmailSender();
  const orgIds: string[] = [];
  let userId: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    setEmailSender(mail);
    const signup = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        orgName: "Sess",
        email: "se-user@example.com",
        name: "Owner",
        password: PASSWORD,
      },
    });
    const body = signup.json();
    orgIds.push(body.org.id);
    userId = body.user.id;
    await app.inject({
      method: "POST",
      url: "/v1/auth/verify-email",
      payload: { token: mail.lastToken() },
    });
  });

  afterAll(async () => {
    setEmailSender(null);
    await cleanupOrgs(orgIds);
    await app.close();
    await pool.end();
  });

  async function login(): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "se-user@example.com", password: PASSWORD },
    });
    return res.json().sessionToken as string;
  }

  it("rejects a session whose expiry has passed", async () => {
    const token = await login();
    expect(
      (await app.inject({ method: "GET", url: "/v1/me", headers: bearer(token) })).statusCode,
    ).toBe(200);

    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, userId));

    expect(
      (await app.inject({ method: "GET", url: "/v1/me", headers: bearer(token) })).statusCode,
    ).toBe(401);
  });

  it("rejects a revoked session", async () => {
    const token = await login();
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.userId, userId));

    expect(
      (await app.inject({ method: "GET", url: "/v1/me", headers: bearer(token) })).statusCode,
    ).toBe(401);
  });
});
