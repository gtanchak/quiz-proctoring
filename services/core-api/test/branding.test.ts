import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client.js";
import { createTestApp, type TestApp } from "./helpers/app.js";
import { type SeededKey, cleanupOrgs, seedOrgWithKey } from "./helpers/seed.js";

/**
 * Per-tenant branding (PRO-57, FR-39): a tenant_admin sets a logo, colour, and
 * unique subdomain; values are tenant-scoped, validated, and subdomains are
 * unique across tenants.
 */
describe("tenant branding (/v1/org/branding)", () => {
  let app: TestApp;
  let a: SeededKey;
  let b: SeededKey;

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createTestApp();
    a = await seedOrgWithKey("brand-a");
    b = await seedOrgWithKey("brand-b");
  });

  afterAll(async () => {
    await cleanupOrgs([a.orgId, b.orgId]);
    await app.close();
    await pool.end();
  });

  it("defaults to null branding", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/org/branding",
      headers: auth(a.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      logoUrl: null,
      primaryColor: null,
      subdomain: null,
    });
  });

  it("updates branding and reflects it on read", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: "/v1/org/branding",
      headers: auth(a.token),
      payload: {
        logoUrl: "https://cdn.test/logo.png",
        primaryColor: "#1a2b3c",
        subdomain: "tenant-a-sub",
      },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toEqual({
      logoUrl: "https://cdn.test/logo.png",
      primaryColor: "#1a2b3c",
      subdomain: "tenant-a-sub",
    });

    const get = await app.inject({
      method: "GET",
      url: "/v1/org/branding",
      headers: auth(a.token),
    });
    expect(get.json().subdomain).toBe("tenant-a-sub");
  });

  it("clears a field when set to null", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/org/branding",
      headers: auth(a.token),
      payload: { logoUrl: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().logoUrl).toBeNull();
    // Other fields are untouched.
    expect(res.json().primaryColor).toBe("#1a2b3c");
  });

  it("rejects an invalid colour or subdomain (400)", async () => {
    for (const payload of [
      { primaryColor: "red" },
      { subdomain: "Not A Subdomain" },
    ]) {
      const res = await app.inject({
        method: "PATCH",
        url: "/v1/org/branding",
        headers: auth(a.token),
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION");
    }
  });

  it("enforces subdomain uniqueness across tenants (409)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/org/branding",
      headers: auth(b.token),
      payload: { subdomain: "tenant-a-sub" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT");
  });
});
