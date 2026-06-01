import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { db, pool } from "../src/db/client.js";
import { attempts } from "../src/db/schema/tests.js";
import { type SeededKey, cleanupOrgs, seedOrgWithKey } from "./helpers/seed.js";

describe("attempt lifecycle & server-authoritative timer", () => {
  let app: FastifyInstance;
  let ownerA: SeededKey;
  let ownerB: SeededKey;

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  /** Creates a published test (with one question) owned by ownerA. */
  async function publishedTest(durationMinutes?: number): Promise<string> {
    const t = (
      await app.inject({
        method: "POST",
        url: "/v1/tests",
        headers: auth(ownerA.token),
        payload: { title: "Timed", durationMinutes },
      })
    ).json();
    await app.inject({
      method: "POST",
      url: `/v1/tests/${t.id}/questions`,
      headers: auth(ownerA.token),
      payload: {
        type: "mcq_single",
        prompt: "Q",
        options: [
          { text: "a", correct: true },
          { text: "b", correct: false },
        ],
      },
    });
    await app.inject({
      method: "POST",
      url: `/v1/tests/${t.id}/publish`,
      headers: auth(ownerA.token),
    });
    return t.id;
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    ownerA = await seedOrgWithKey("attempt-owner-a");
    ownerB = await seedOrgWithKey("attempt-owner-b");
  });

  afterAll(async () => {
    await cleanupOrgs([ownerA.orgId, ownerB.orgId]);
    await app.close();
    await pool.end();
  });

  it("starts an attempt with a server-set deadline and remaining time", async () => {
    const testId = await publishedTest(60);
    const res = await app.inject({
      method: "POST",
      url: `/v1/tests/${testId}/attempts`,
      headers: auth(ownerA.token),
      payload: { candidateEmail: "c@example.com" },
    });
    expect(res.statusCode).toBe(201);
    const a = res.json();
    expect(a.status).toBe("in_progress");
    expect(a.startedAt).toBeTruthy();
    expect(a.deadlineAt).toBeTruthy();
    expect(a.expired).toBe(false);
    // ~60 minutes, allow slack for execution time.
    expect(a.remainingMs).toBeGreaterThan(59 * 60_000);
    expect(a.remainingMs).toBeLessThanOrEqual(60 * 60_000);
  });

  it("refuses to start an attempt on a draft test (409)", async () => {
    const t = (
      await app.inject({
        method: "POST",
        url: "/v1/tests",
        headers: auth(ownerA.token),
        payload: { title: "Draft" },
      })
    ).json();
    const res = await app.inject({
      method: "POST",
      url: `/v1/tests/${t.id}/attempts`,
      headers: auth(ownerA.token),
      payload: {},
    });
    expect(res.statusCode).toBe(409);
  });

  it("treats a test with no duration as untimed", async () => {
    const testId = await publishedTest(undefined);
    const a = (
      await app.inject({
        method: "POST",
        url: `/v1/tests/${testId}/attempts`,
        headers: auth(ownerA.token),
        payload: {},
      })
    ).json();
    expect(a.deadlineAt).toBeNull();
    expect(a.remainingMs).toBeNull();
    expect(a.expired).toBe(false);
  });

  it("auto-submits and locks an attempt whose deadline has passed", async () => {
    const testId = await publishedTest(30);
    const past = new Date(Date.now() - 60_000);
    const [row] = await db
      .insert(attempts)
      .values({
        testId,
        status: "in_progress",
        startedAt: new Date(Date.now() - 31 * 60_000),
        deadlineAt: past,
      })
      .returning({ id: attempts.id });

    const read = await app.inject({
      method: "GET",
      url: `/v1/attempts/${row.id}`,
      headers: auth(ownerA.token),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({
      status: "expired",
      expired: true,
      remainingMs: 0,
    });
    expect(read.json().submittedAt).toBeTruthy();

    // Locked: submitting an already-finalized attempt is rejected.
    const submit = await app.inject({
      method: "POST",
      url: `/v1/attempts/${row.id}/submit`,
      headers: auth(ownerA.token),
    });
    expect(submit.statusCode).toBe(409);
  });

  it("submits an in-progress attempt and rejects a second submit", async () => {
    const testId = await publishedTest(60);
    const attempt = (
      await app.inject({
        method: "POST",
        url: `/v1/tests/${testId}/attempts`,
        headers: auth(ownerA.token),
        payload: {},
      })
    ).json();

    const first = await app.inject({
      method: "POST",
      url: `/v1/attempts/${attempt.id}/submit`,
      headers: auth(ownerA.token),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ status: "submitted" });
    expect(first.json().submittedAt).toBeTruthy();

    const second = await app.inject({
      method: "POST",
      url: `/v1/attempts/${attempt.id}/submit`,
      headers: auth(ownerA.token),
    });
    expect(second.statusCode).toBe(409);
  });

  it("does not leak attempts across tenants", async () => {
    const testId = await publishedTest(60);
    const attempt = (
      await app.inject({
        method: "POST",
        url: `/v1/tests/${testId}/attempts`,
        headers: auth(ownerA.token),
        payload: {},
      })
    ).json();
    const res = await app.inject({
      method: "GET",
      url: `/v1/attempts/${attempt.id}`,
      headers: auth(ownerB.token),
    });
    expect(res.statusCode).toBe(404);
  });
});
