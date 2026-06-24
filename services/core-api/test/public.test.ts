import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers/app.js";
import { pool } from "../src/db/client.js";
import { type SeededKey, cleanupOrgs, seedOrgWithKey } from "./helpers/seed.js";

describe("candidate access via share links (/v1/public)", () => {
  let app: TestApp;
  let owner: SeededKey;

  const admin = () => ({ authorization: `Bearer ${owner.token}` });
  const session = (t: string) => ({ authorization: `Bearer ${t}` });

  /** Creates a published test (with one question) and returns its id + link token. */
  async function publishedTest(
    opts: {
      accessMode?: "open" | "invite";
      maxAttempts?: number;
      availableFrom?: string;
      durationMinutes?: number;
    } = {},
  ): Promise<{ id: string; token: string }> {
    const t = (
      await app.inject({
        method: "POST",
        url: "/v1/tests",
        headers: admin(),
        payload: { title: "Shared", ...opts },
      })
    ).json();
    await app.inject({
      method: "POST",
      url: `/v1/tests/${t.id}/questions`,
      headers: admin(),
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
      headers: admin(),
    });
    return { id: t.id, token: t.accessToken };
  }

  beforeAll(async () => {
    app = await createTestApp();
    owner = await seedOrgWithKey("access-owner");
  });

  afterAll(async () => {
    await cleanupOrgs([owner.orgId]);
    await app.close();
    await pool.end();
  });

  it("creates a test with a shareable access token", async () => {
    const { token } = await publishedTest();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(10);
  });

  it("landing shows open state for a published test, closed for a draft", async () => {
    const { token } = await publishedTest();
    const open = await app.inject({
      method: "GET",
      url: `/v1/public/tests/${token}`,
    });
    expect(open.statusCode).toBe(200);
    expect(open.json()).toMatchObject({ title: "Shared", state: "open" });

    const draft = (
      await app.inject({
        method: "POST",
        url: "/v1/tests",
        headers: admin(),
        payload: { title: "Draft" },
      })
    ).json();
    const closed = await app.inject({
      method: "GET",
      url: `/v1/public/tests/${draft.accessToken}`,
    });
    expect(closed.json().state).toBe("closed");
  });

  it("landing is not_yet_open before the availability window, and start is rejected", async () => {
    const { token } = await publishedTest({
      availableFrom: "2099-01-01T00:00:00.000Z",
    });
    const landing = await app.inject({
      method: "GET",
      url: `/v1/public/tests/${token}`,
    });
    expect(landing.json().state).toBe("not_yet_open");

    const start = await app.inject({
      method: "POST",
      url: `/v1/public/tests/${token}/start`,
      payload: { candidateEmail: "c@example.com" },
    });
    expect(start.statusCode).toBe(409);
  });

  it("starts, polls, and submits an attempt with a session token", async () => {
    const { token } = await publishedTest({ durationMinutes: 30 });
    const start = await app.inject({
      method: "POST",
      url: `/v1/public/tests/${token}/start`,
      payload: { candidateEmail: "alice@example.com" },
    });
    expect(start.statusCode).toBe(201);
    const { attempt, sessionToken, resumed } = start.json();
    expect(resumed).toBe(false);
    expect(attempt.status).toBe("in_progress");
    expect(attempt.remainingMs).toBeGreaterThan(0);

    const poll = await app.inject({
      method: "GET",
      url: "/v1/public/attempt",
      headers: session(sessionToken),
    });
    expect(poll.statusCode).toBe(200);
    expect(poll.json().id).toBe(attempt.id);

    const submit = await app.inject({
      method: "POST",
      url: "/v1/public/attempt/submit",
      headers: session(sessionToken),
    });
    expect(submit.statusCode).toBe(200);
    expect(submit.json().status).toBe("submitted");

    const again = await app.inject({
      method: "POST",
      url: "/v1/public/attempt/submit",
      headers: session(sessionToken),
    });
    expect(again.statusCode).toBe(409);
  });

  it("resumes an in-progress attempt instead of creating a new one", async () => {
    const { token } = await publishedTest({ durationMinutes: 30 });
    const first = (
      await app.inject({
        method: "POST",
        url: `/v1/public/tests/${token}/start`,
        payload: { candidateEmail: "bob@example.com" },
      })
    ).json();
    const second = await app.inject({
      method: "POST",
      url: `/v1/public/tests/${token}/start`,
      payload: { candidateEmail: "bob@example.com" },
    });
    // Resume returns 200 (no new resource), distinct from 201 on create.
    expect(second.statusCode).toBe(200);
    expect(second.json().resumed).toBe(true);
    expect(second.json().attempt.id).toBe(first.attempt.id);
  });

  it("enforces max-attempts after an attempt is finalized", async () => {
    const { token } = await publishedTest({ maxAttempts: 1, durationMinutes: 30 });
    const started = (
      await app.inject({
        method: "POST",
        url: `/v1/public/tests/${token}/start`,
        payload: { candidateEmail: "carol@example.com" },
      })
    ).json();
    await app.inject({
      method: "POST",
      url: "/v1/public/attempt/submit",
      headers: session(started.sessionToken),
    });

    const blocked = await app.inject({
      method: "POST",
      url: `/v1/public/tests/${token}/start`,
      payload: { candidateEmail: "carol@example.com" },
    });
    expect(blocked.statusCode).toBe(403);
  });

  it("invite-only links admit invited emails and reject others", async () => {
    const { id, token } = await publishedTest({ accessMode: "invite" });
    await app.inject({
      method: "POST",
      url: `/v1/tests/${id}/invites`,
      headers: admin(),
      payload: { email: "Invited@Example.com" },
    });

    const ok = await app.inject({
      method: "POST",
      url: `/v1/public/tests/${token}/start`,
      payload: { candidateEmail: "invited@example.com" },
    });
    expect(ok.statusCode).toBe(201);

    const rejected = await app.inject({
      method: "POST",
      url: `/v1/public/tests/${token}/start`,
      payload: { candidateEmail: "stranger@example.com" },
    });
    expect(rejected.statusCode).toBe(403);
  });

  it("rejects an invalid session token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/public/attempt",
      headers: session("ats_not-real"),
    });
    expect(res.statusCode).toBe(401);
  });

  it("does not require an admin key for public routes", async () => {
    const { token } = await publishedTest();
    const res = await app.inject({
      method: "GET",
      url: `/v1/public/tests/${token}`,
    });
    expect(res.statusCode).toBe(200);
  });
});
