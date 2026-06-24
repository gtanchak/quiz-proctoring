import type { TenantSummaryDto } from "@proctoring/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client.js";
import { organizations, users } from "../src/db/schema/accounts.js";
import { setEmailSender } from "../src/lib/email.js";
import { hashPassword } from "../src/lib/password.js";
import { createTestApp, type TestApp } from "./helpers/app.js";
import { CapturingEmailSender } from "./helpers/email.js";
import { type SeededKey, cleanupOrgs, seedOrgWithKey } from "./helpers/seed.js";

const PASSWORD = "platform-admin-pw-123";

/**
 * Platform tenant provisioning (PRO-57): a cross-tenant `platform_admin`
 * provisions tenants (creating the tenant + inviting its first tenant_admin),
 * lists them, and the boundary is enforced — non-platform actors are forbidden.
 */
describe("platform tenant provisioning (/v1/platform)", () => {
  let app: TestApp;
  let mail: CapturingEmailSender;
  let platformToken: string;
  let tenant: SeededKey;
  const createdOrgIds: string[] = [];

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createTestApp();
    mail = new CapturingEmailSender();
    setEmailSender(mail);

    // Seed a platform_admin directly — no public API provisions one.
    const [org] = await db
      .insert(organizations)
      .values({ name: "Platform-test" })
      .returning({ id: organizations.id });
    createdOrgIds.push(org.id);
    const email = "platform@example.com";
    await db.insert(users).values({
      orgId: org.id,
      email,
      name: "Platform Admin",
      role: "platform_admin",
      passwordHash: hashPassword(PASSWORD),
      emailVerifiedAt: new Date(),
    });
    platformToken = (
      await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email, password: PASSWORD },
      })
    ).json().sessionToken;

    // A normal tenant (its API key authenticates as tenant_admin) for the
    // forbidden-access case.
    tenant = await seedOrgWithKey("platform-neg");
  });

  afterAll(async () => {
    setEmailSender(null);
    await cleanupOrgs([...createdOrgIds, tenant.orgId]);
    await app.close();
    await pool.end();
  });

  it("provisions a tenant + first admin (201), admin invited not credentialed", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/platform/tenants",
      headers: auth(platformToken),
      payload: {
        name: "Acme Corp",
        adminEmail: "owner@acme.test",
        adminName: "Acme Owner",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.tenant.name).toBe("Acme Corp");
    expect(body.admin.role).toBe("tenant_admin");
    expect(body.admin.email).toBe("owner@acme.test");
    // Invited, not credentialed — they verify by completing the emailed link.
    expect(body.admin.emailVerifiedAt).toBeNull();
    createdOrgIds.push(body.tenant.id);
  });

  it("emails the new admin an onboarding link they use to set a password + log in", async () => {
    const token = mail.lastToken();
    const reset = await app.inject({
      method: "POST",
      url: "/v1/auth/reset-password",
      payload: { token, password: "acme-owner-pw-1" },
    });
    expect(reset.statusCode).toBe(200);

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "owner@acme.test", password: "acme-owner-pw-1" },
    });
    expect(login.statusCode).toBe(200);
  });

  it("lists tenants for a platform_admin, with member counts", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/platform/tenants",
      headers: auth(platformToken),
    });
    expect(res.statusCode).toBe(200);
    const list = res.json() as TenantSummaryDto[];
    const acme = list.find((t) => t.name === "Acme Corp");
    expect(acme).toBeDefined();
    expect(acme?.memberCount).toBeGreaterThanOrEqual(1);
  });

  it("forbids non-platform actors (403)", async () => {
    for (const call of [
      {
        method: "POST" as const,
        url: "/v1/platform/tenants",
        payload: { name: "X", adminEmail: "x@y.test", adminName: "X" },
      },
      { method: "GET" as const, url: "/v1/platform/tenants" },
    ]) {
      const res = await app.inject({ ...call, headers: auth(tenant.token) });
      expect(res.statusCode, `${call.method} ${call.url}`).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
    }
  });
});
