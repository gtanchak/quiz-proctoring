import { inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { db, pool } from "../src/db/client.js";
import { apiKeys } from "../src/db/schema/api-keys.js";
import { attempts, tests } from "../src/db/schema/tests.js";
import { generateApiKey } from "../src/lib/api-key.js";

/** Seeds an API key and returns its raw token + id. */
async function seedKey(name: string): Promise<{ token: string; id: string }> {
  const key = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({ name, keyPrefix: key.prefix, keyHash: key.hash })
    .returning({ id: apiKeys.id });
  return { token: key.token, id: row.id };
}

describe("tests resource (/v1/tests)", () => {
  let app: FastifyInstance;
  let ownerA: { token: string; id: string };
  let ownerB: { token: string; id: string };

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    ownerA = await seedKey("owner-a");
    ownerB = await seedKey("owner-b");
  });

  afterAll(async () => {
    // attempts cascade from tests; remove tests then the keys.
    await db
      .delete(tests)
      .where(inArray(tests.ownerKeyId, [ownerA.id, ownerB.id]));
    await db.delete(apiKeys).where(inArray(apiKeys.id, [ownerA.id, ownerB.id]));
    await app.close();
    await pool.end();
  });

  it("creates a test (201) and rejects an empty title (400 VALIDATION)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/tests",
      headers: auth(ownerA.token),
      payload: { title: "Algebra I", durationSeconds: 3600 },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body).toMatchObject({ title: "Algebra I", status: "draft" });
    expect(body.id).toBeDefined();

    const bad = await app.inject({
      method: "POST",
      url: "/v1/tests",
      headers: auth(ownerA.token),
      payload: { title: "" },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("VALIDATION");
  });

  it("lists with pagination envelope and filters by status", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/tests",
      headers: auth(ownerA.token),
      payload: { title: "Published one", status: "published" },
    });

    const all = await app.inject({
      method: "GET",
      url: "/v1/tests?limit=1",
      headers: auth(ownerA.token),
    });
    expect(all.statusCode).toBe(200);
    const page = all.json();
    expect(page.data).toHaveLength(1);
    expect(page.pagination.total).toBeGreaterThanOrEqual(2);
    expect(page.pagination.limit).toBe(1);

    const published = await app.inject({
      method: "GET",
      url: "/v1/tests?status=published",
      headers: auth(ownerA.token),
    });
    expect(
      published.json().data.every((t: { status: string }) => t.status === "published"),
    ).toBe(true);
  });

  it("reads, updates, and deletes a test by id", async () => {
    const created = (
      await app.inject({
        method: "POST",
        url: "/v1/tests",
        headers: auth(ownerA.token),
        payload: { title: "Lifecycle" },
      })
    ).json();

    const read = await app.inject({
      method: "GET",
      url: `/v1/tests/${created.id}`,
      headers: auth(ownerA.token),
    });
    expect(read.statusCode).toBe(200);

    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/tests/${created.id}`,
      headers: auth(ownerA.token),
      payload: { title: "Lifecycle (renamed)", status: "published" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      title: "Lifecycle (renamed)",
      status: "published",
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/tests/${created.id}`,
      headers: auth(ownerA.token),
    });
    expect(deleted.statusCode).toBe(204);

    const gone = await app.inject({
      method: "GET",
      url: `/v1/tests/${created.id}`,
      headers: auth(ownerA.token),
    });
    expect(gone.statusCode).toBe(404);
  });

  it("isolates tenants: owner B cannot see or fetch owner A's test", async () => {
    const aTest = (
      await app.inject({
        method: "POST",
        url: "/v1/tests",
        headers: auth(ownerA.token),
        payload: { title: "A private" },
      })
    ).json();

    const bGet = await app.inject({
      method: "GET",
      url: `/v1/tests/${aTest.id}`,
      headers: auth(ownerB.token),
    });
    expect(bGet.statusCode).toBe(404);

    const bList = await app.inject({
      method: "GET",
      url: "/v1/tests",
      headers: auth(ownerB.token),
    });
    expect(
      bList.json().data.some((t: { id: string }) => t.id === aTest.id),
    ).toBe(false);
  });

  it("lists and reads attempts scoped through the owning test", async () => {
    const test = (
      await app.inject({
        method: "POST",
        url: "/v1/tests",
        headers: auth(ownerA.token),
        payload: { title: "With attempts" },
      })
    ).json();

    const [attempt] = await db
      .insert(attempts)
      .values({ testId: test.id, candidateEmail: "c@example.com" })
      .returning({ id: attempts.id });

    const list = await app.inject({
      method: "GET",
      url: `/v1/tests/${test.id}/attempts`,
      headers: auth(ownerA.token),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);

    const read = await app.inject({
      method: "GET",
      url: `/v1/attempts/${attempt.id}`,
      headers: auth(ownerA.token),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ testId: test.id });

    // Owner B cannot read owner A's attempt.
    const bRead = await app.inject({
      method: "GET",
      url: `/v1/attempts/${attempt.id}`,
      headers: auth(ownerB.token),
    });
    expect(bRead.statusCode).toBe(404);
  });
});
