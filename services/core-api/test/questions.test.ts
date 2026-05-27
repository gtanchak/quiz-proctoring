import { eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { db, pool } from "../src/db/client.js";
import { apiKeys } from "../src/db/schema/api-keys.js";
import { attempts, questions, tests } from "../src/db/schema/tests.js";
import { generateApiKey } from "../src/lib/api-key.js";

async function seedKey(name: string): Promise<{ token: string; id: string }> {
  const key = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({ name, keyPrefix: key.prefix, keyHash: key.hash })
    .returning({ id: apiKeys.id });
  return { token: key.token, id: row.id };
}

describe("MCQ question authoring (/v1/tests/:testId/questions)", () => {
  let app: FastifyInstance;
  let ownerA: { token: string; id: string };
  let ownerB: { token: string; id: string };
  let testId: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  const singleBody = {
    type: "mcq_single",
    prompt: "Capital of France?",
    points: 2,
    options: [
      { text: "Paris", correct: true },
      { text: "Lyon", correct: false },
      { text: "Nice", correct: false },
    ],
  };

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    ownerA = await seedKey("q-owner-a");
    ownerB = await seedKey("q-owner-b");
    const created = await app.inject({
      method: "POST",
      url: "/v1/tests",
      headers: auth(ownerA.token),
      payload: { title: "Question host" },
    });
    testId = created.json().id;
  });

  afterAll(async () => {
    await db.delete(tests).where(inArray(tests.ownerKeyId, [ownerA.id, ownerB.id]));
    await db.delete(apiKeys).where(inArray(apiKeys.id, [ownerA.id, ownerB.id]));
    await app.close();
    await pool.end();
  });

  it("creates an MCQ, assigns option ids, and flags the correct one", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/tests/${testId}/questions`,
      headers: auth(ownerA.token),
      payload: singleBody,
    });
    expect(res.statusCode).toBe(201);
    const q = res.json();
    expect(q.type).toBe("mcq_single");
    expect(q.options).toHaveLength(3);
    expect(q.options.every((o: { id: string }) => typeof o.id === "string")).toBe(
      true,
    );
    const correct = q.options.filter((o: { correct: boolean }) => o.correct);
    expect(correct).toHaveLength(1);
    expect(correct[0].text).toBe("Paris");
  });

  it("rejects fewer than 2 options (schema) ", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/tests/${testId}/questions`,
      headers: auth(ownerA.token),
      payload: {
        type: "mcq_single",
        prompt: "X",
        options: [{ text: "only", correct: true }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a single-correct question with no/multiple correct options", async () => {
    const none = await app.inject({
      method: "POST",
      url: `/v1/tests/${testId}/questions`,
      headers: auth(ownerA.token),
      payload: {
        type: "mcq_single",
        prompt: "X",
        options: [
          { text: "a", correct: false },
          { text: "b", correct: false },
        ],
      },
    });
    expect(none.statusCode).toBe(400);

    const two = await app.inject({
      method: "POST",
      url: `/v1/tests/${testId}/questions`,
      headers: auth(ownerA.token),
      payload: {
        type: "mcq_single",
        prompt: "X",
        options: [
          { text: "a", correct: true },
          { text: "b", correct: true },
        ],
      },
    });
    expect(two.statusCode).toBe(400);
    expect(two.json().error.message).toMatch(/exactly one correct/i);
  });

  it("creates a multi-correct question with partial grading", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/tests/${testId}/questions`,
      headers: auth(ownerA.token),
      payload: {
        type: "mcq_multiple",
        prompt: "Pick the primes",
        gradingMode: "partial",
        options: [
          { text: "2", correct: true },
          { text: "3", correct: true },
          { text: "4", correct: false },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().gradingMode).toBe("partial");
  });

  it("lists, reads, updates, and deletes questions", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/v1/tests/${testId}/questions`,
      headers: auth(ownerA.token),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().length).toBeGreaterThanOrEqual(2);
    const first = list.json()[0];

    const read = await app.inject({
      method: "GET",
      url: `/v1/tests/${testId}/questions/${first.id}`,
      headers: auth(ownerA.token),
    });
    expect(read.statusCode).toBe(200);

    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/tests/${testId}/questions/${first.id}`,
      headers: auth(ownerA.token),
      payload: { prompt: "Updated prompt", points: 5 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ prompt: "Updated prompt", points: 5 });

    const del = await app.inject({
      method: "DELETE",
      url: `/v1/tests/${testId}/questions/${first.id}`,
      headers: auth(ownerA.token),
    });
    expect(del.statusCode).toBe(204);

    const gone = await app.inject({
      method: "GET",
      url: `/v1/tests/${testId}/questions/${first.id}`,
      headers: auth(ownerA.token),
    });
    expect(gone.statusCode).toBe(404);
  });

  it("isolates tenants: owner B cannot add questions to owner A's test", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/tests/${testId}/questions`,
      headers: auth(ownerB.token),
      payload: singleBody,
    });
    expect(res.statusCode).toBe(404);
  });

  it("blocks adding a question to a published test with an attempt in progress", async () => {
    const t = (
      await app.inject({
        method: "POST",
        url: "/v1/tests",
        headers: auth(ownerA.token),
        payload: { title: "Live test" },
      })
    ).json();
    await app.inject({
      method: "POST",
      url: `/v1/tests/${t.id}/questions`,
      headers: auth(ownerA.token),
      payload: singleBody,
    });
    await app.inject({
      method: "POST",
      url: `/v1/tests/${t.id}/publish`,
      headers: auth(ownerA.token),
    });
    await db.insert(attempts).values({ testId: t.id, status: "in_progress" });

    const res = await app.inject({
      method: "POST",
      url: `/v1/tests/${t.id}/questions`,
      headers: auth(ownerA.token),
      payload: singleBody,
    });
    expect(res.statusCode).toBe(409);
  });

  it("cascades question deletion when its test is deleted", async () => {
    const t = (
      await app.inject({
        method: "POST",
        url: "/v1/tests",
        headers: auth(ownerA.token),
        payload: { title: "Cascade" },
      })
    ).json();
    await app.inject({
      method: "POST",
      url: `/v1/tests/${t.id}/questions`,
      headers: auth(ownerA.token),
      payload: singleBody,
    });
    await app.inject({
      method: "DELETE",
      url: `/v1/tests/${t.id}`,
      headers: auth(ownerA.token),
    });
    const remaining = await db
      .select()
      .from(questions)
      .where(eq(questions.testId, t.id));
    expect(remaining).toHaveLength(0);
  });
});
