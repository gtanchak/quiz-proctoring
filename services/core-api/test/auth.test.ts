import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { db, pool } from "../src/db/client.js";
import { apiKeys } from "../src/db/schema/api-keys.js";
import { generateApiKey } from "../src/lib/api-key.js";

describe("API-key auth on /v1", () => {
  let app: FastifyInstance;
  let token: string;
  let keyId: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const key = generateApiKey();
    token = key.token;
    const [row] = await db
      .insert(apiKeys)
      .values({ name: "test-key", keyPrefix: key.prefix, keyHash: key.hash })
      .returning({ id: apiKeys.id });
    keyId = row.id;
  });

  afterAll(async () => {
    await db.delete(apiKeys).where(eq(apiKeys.id, keyId));
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

  it("accepts a valid key and returns its identity", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: keyId, name: "test-key" });
  });

  it("exposes rate-limit headers", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
  });

  it("rejects a revoked key", async () => {
    await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.id, keyId));

    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });
});
