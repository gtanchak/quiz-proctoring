import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { db, pool } from "../src/db/client.js";
import { attempts, questions } from "../src/db/schema/tests.js";
import { type SeededKey, cleanupOrgs, seedOrgWithKey } from "./helpers/seed.js";

describe("test configuration & publish lifecycle", () => {
  let app: FastifyInstance;
  let seeded: SeededKey;

  const auth = () => ({ authorization: `Bearer ${seeded.token}` });

  const createTest = async (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/v1/tests", headers: auth(), payload });

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    seeded = await seedOrgWithKey("lifecycle");
  });

  afterAll(async () => {
    await cleanupOrgs([seeded.orgId]);
    await app.close();
    await pool.end();
  });

  it("round-trips configuration settings", async () => {
    const res = await createTest({
      title: "Configured",
      instructions: "Read carefully.",
      durationMinutes: 90,
      maxAttempts: 3,
      passMark: 40,
      negativeMarking: true,
      availableFrom: "2026-06-01T09:00:00.000Z",
      availableUntil: "2026-06-30T17:00:00.000Z",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      title: "Configured",
      instructions: "Read carefully.",
      durationMinutes: 90,
      maxAttempts: 3,
      passMark: 40,
      negativeMarking: true,
      status: "draft",
      availableFrom: "2026-06-01T09:00:00.000Z",
      availableUntil: "2026-06-30T17:00:00.000Z",
    });
  });

  it("rejects an invalid availability window (400)", async () => {
    const res = await createTest({
      title: "Bad window",
      availableFrom: "2026-06-30T00:00:00.000Z",
      availableUntil: "2026-06-01T00:00:00.000Z",
    });
    expect(res.statusCode).toBe(400);
  });

  it("ignores unknown fields (stripped by validation)", async () => {
    // additionalProperties:false + Fastify's default Ajv strips unknown keys
    // rather than rejecting — the stray field never reaches the database.
    const res = await createTest({ title: "X", durationSeconds: 60 });
    expect(res.statusCode).toBe(201);
    expect(res.json().durationMinutes).toBeNull();
    expect(res.json()).not.toHaveProperty("durationSeconds");
  });

  it("blocks publishing a test with no questions (409)", async () => {
    const created = (await createTest({ title: "Empty" })).json();
    const res = await app.inject({
      method: "POST",
      url: `/v1/tests/${created.id}/publish`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/no questions/i);
  });

  it("publishes a test once it has a question, and can unpublish", async () => {
    const created = (await createTest({ title: "Publishable" })).json();
    await db.insert(questions).values({
      testId: created.id,
      type: "mcq_single",
      prompt: "2+2?",
      points: 1,
      position: 0,
    });

    const published = await app.inject({
      method: "POST",
      url: `/v1/tests/${created.id}/publish`,
      headers: auth(),
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().status).toBe("published");

    const unpublished = await app.inject({
      method: "POST",
      url: `/v1/tests/${created.id}/unpublish`,
      headers: auth(),
    });
    expect(unpublished.statusCode).toBe(200);
    expect(unpublished.json().status).toBe("draft");
  });

  it("makes a published test immutable while an attempt is in progress", async () => {
    const created = (await createTest({ title: "Live" })).json();
    await db.insert(questions).values({
      testId: created.id,
      type: "mcq_single",
      prompt: "Q",
      points: 1,
      position: 0,
    });
    await app.inject({
      method: "POST",
      url: `/v1/tests/${created.id}/publish`,
      headers: auth(),
    });
    await db
      .insert(attempts)
      .values({ testId: created.id, status: "in_progress" });

    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/tests/${created.id}`,
      headers: auth(),
      payload: { title: "Renamed mid-attempt" },
    });
    expect(patch.statusCode).toBe(409);

    const del = await app.inject({
      method: "DELETE",
      url: `/v1/tests/${created.id}`,
      headers: auth(),
    });
    expect(del.statusCode).toBe(409);
  });
});
