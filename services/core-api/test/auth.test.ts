import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { db, pool } from "../src/db/client.js";
import { apiKeys } from "../src/db/schema/api-keys.js";
import { type SeededKey, cleanupOrgs, seedOrgWithKey } from "./helpers/seed.js";

describe("API-key auth on /v1", () => {
  let app: FastifyInstance;
  let seeded: SeededKey;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    seeded = await seedOrgWithKey("test-key");
  });

  afterAll(async () => {
    await cleanupOrgs([seeded.orgId]);
    await app.close();
    await pool.end();
  });

  it("rejects /v1 requests with no key (401 UNAUTHORIZED)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("rejects an unknown key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: "Bearer proct_not-a-real-key" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts a valid key and returns its identity as an apiKey actor", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${seeded.token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      actorType: "apiKey",
      orgId: seeded.orgId,
      apiKey: { id: seeded.keyId, name: "test-key" },
    });
  });

  it("exposes rate-limit headers", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${seeded.token}` },
    });
    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
  });

  it("rejects a revoked key", async () => {
    await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.id, seeded.keyId));

    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${seeded.token}` },
    });
    expect(res.statusCode).toBe(401);
  });
});
