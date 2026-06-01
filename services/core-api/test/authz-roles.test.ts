import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { db, pool } from "../src/db/client.js";
import { auditLog } from "../src/db/schema/accounts.js";
import { setEmailSender } from "../src/lib/email.js";
import { CapturingEmailSender } from "./helpers/email.js";
import { cleanupOrgs } from "./helpers/seed.js";

const PASSWORD = "correct-horse-battery-staple";
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

/**
 * Audit writes are fire-and-forget (they never block the request), so poll
 * briefly for the row rather than racing the background insert.
 */
async function waitFor<T>(fn: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 40; i++) {
    const result = await fn();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition not met within timeout");
}

interface Account {
  orgId: string;
  ownerToken: string;
  ownerUserId: string;
}

describe("role gating & org isolation", () => {
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

  /** Signs up + verifies an owner, returns their session + ids. */
  async function newAccount(prefix: string): Promise<Account> {
    const email = `${prefix}-owner@example.com`;
    const signup = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { orgName: `${prefix}-org`, email, name: "Owner", password: PASSWORD },
    });
    const body = signup.json();
    orgIds.push(body.org.id);
    await app.inject({
      method: "POST",
      url: "/v1/auth/verify-email",
      payload: { token: mail.lastToken() },
    });
    const ownerToken = (
      await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email, password: PASSWORD },
      })
    ).json().sessionToken as string;
    return { orgId: body.org.id, ownerToken, ownerUserId: body.user.id };
  }

  /** Owner invites a member; the member sets their password and logs in. */
  async function invitedMember(
    ownerToken: string,
    email: string,
    role: "admin" | "viewer",
  ): Promise<{ token: string; userId: string }> {
    const invite = await app.inject({
      method: "POST",
      url: "/v1/org/users",
      headers: bearer(ownerToken),
      payload: { email, name: role, role },
    });
    expect(invite.statusCode).toBe(201);
    const userId = invite.json().id as string;
    await app.inject({
      method: "POST",
      url: "/v1/auth/reset-password",
      payload: { token: mail.lastToken(), password: PASSWORD },
    });
    const token = (
      await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email, password: PASSWORD },
      })
    ).json().sessionToken as string;
    return { token, userId };
  }

  it("lets viewers read but not mutate; admins can mutate", async () => {
    const acct = await newAccount("rg");
    const viewer = await invitedMember(acct.ownerToken, "rg-viewer@example.com", "viewer");
    const admin = await invitedMember(acct.ownerToken, "rg-admin@example.com", "admin");

    // Admin creates a test.
    const created = await app.inject({
      method: "POST",
      url: "/v1/tests",
      headers: bearer(admin.token),
      payload: { title: "Admin test" },
    });
    expect(created.statusCode).toBe(201);
    const testId = created.json().id;

    // Viewer can read it...
    const read = await app.inject({
      method: "GET",
      url: `/v1/tests/${testId}`,
      headers: bearer(viewer.token),
    });
    expect(read.statusCode).toBe(200);

    // ...but cannot create, update, delete, or publish (403).
    for (const call of [
      { method: "POST" as const, url: "/v1/tests", payload: { title: "Nope" } },
      { method: "PATCH" as const, url: `/v1/tests/${testId}`, payload: { title: "Nope" } },
      { method: "DELETE" as const, url: `/v1/tests/${testId}` },
      { method: "POST" as const, url: `/v1/tests/${testId}/publish` },
    ]) {
      const res = await app.inject({ ...call, headers: bearer(viewer.token) });
      expect(res.statusCode, `${call.method} ${call.url}`).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
    }
  });

  it("lets only the owner change roles, and records an audit entry", async () => {
    const acct = await newAccount("rc");
    const viewer = await invitedMember(acct.ownerToken, "rc-viewer@example.com", "viewer");

    // A non-owner cannot change roles.
    const byViewer = await app.inject({
      method: "PATCH",
      url: `/v1/org/users/${viewer.userId}/role`,
      headers: bearer(viewer.token),
      payload: { role: "admin" },
    });
    expect(byViewer.statusCode).toBe(403);

    // The owner can.
    const byOwner = await app.inject({
      method: "PATCH",
      url: `/v1/org/users/${viewer.userId}/role`,
      headers: bearer(acct.ownerToken),
      payload: { role: "admin" },
    });
    expect(byOwner.statusCode).toBe(200);
    expect(byOwner.json().role).toBe("admin");

    const audit = await waitFor(async () => {
      const [row] = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.orgId, acct.orgId),
            eq(auditLog.action, "user.role_changed"),
            eq(auditLog.targetId, viewer.userId),
          ),
        )
        .limit(1);
      return row;
    });
    expect(audit.metadata).toMatchObject({ from: "viewer", to: "admin" });

    // The owner's own role is protected.
    const protect = await app.inject({
      method: "PATCH",
      url: `/v1/org/users/${acct.ownerUserId}/role`,
      headers: bearer(acct.ownerToken),
      payload: { role: "admin" },
    });
    expect(protect.statusCode).toBe(400);
  });

  it("isolates organizations: another org's owner gets 404, not 403", async () => {
    const a = await newAccount("iso-a");
    const b = await newAccount("iso-b");

    const aTest = (
      await app.inject({
        method: "POST",
        url: "/v1/tests",
        headers: bearer(a.ownerToken),
        payload: { title: "A's test" },
      })
    ).json();

    const bRead = await app.inject({
      method: "GET",
      url: `/v1/tests/${aTest.id}`,
      headers: bearer(b.ownerToken),
    });
    expect(bRead.statusCode).toBe(404);

    const bDelete = await app.inject({
      method: "DELETE",
      url: `/v1/tests/${aTest.id}`,
      headers: bearer(b.ownerToken),
    });
    expect(bDelete.statusCode).toBe(404);
  });

  it("records a login audit entry", async () => {
    const acct = await newAccount("audit");
    const row = await waitFor(async () => {
      const [found] = await db
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.orgId, acct.orgId), eq(auditLog.action, "user.login")),
        )
        .limit(1);
      return found;
    });
    expect(row.actorUserId).toBe(acct.ownerUserId);
  });
});
