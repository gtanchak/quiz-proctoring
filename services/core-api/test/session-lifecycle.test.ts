import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client.js";
import { createTestApp, type TestApp } from "./helpers/app.js";
import { type SeededKey, cleanupOrgs, seedOrgWithKey } from "./helpers/seed.js";

/**
 * Candidate session lifecycle (PRO-59): consent before start (FR-18) and the
 * intro → items → wrap_up → complete state machine (FR-19).
 */
describe("candidate session lifecycle (/v1/public)", () => {
  let app: TestApp;
  let tenant: SeededKey;
  let token: string; // share-link access token

  const admin = (t: string) => ({ authorization: `Bearer ${t}` });
  const candidate = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createTestApp();
    tenant = await seedOrgWithKey("session");

    const test = (
      await app.inject({
        method: "POST",
        url: "/v1/tests",
        headers: admin(tenant.token),
        payload: { title: "Session test", durationMinutes: 30 },
      })
    ).json();
    token = test.accessToken;
    await app.inject({
      method: "POST",
      url: `/v1/tests/${test.id}/questions`,
      headers: admin(tenant.token),
      payload: {
        type: "mcq_single",
        prompt: "q",
        options: [
          { text: "a", correct: true },
          { text: "b", correct: false },
        ],
      },
    });
    await app.inject({
      method: "POST",
      url: `/v1/tests/${test.id}/publish`,
      headers: admin(tenant.token),
    });
  });

  afterAll(async () => {
    await cleanupOrgs([tenant.orgId]);
    await app.close();
    await pool.end();
  });

  const start = (email: string, consent: boolean) =>
    app.inject({
      method: "POST",
      url: `/v1/public/tests/${token}/start`,
      payload: { candidateEmail: email, consent },
    });

  it("refuses to start without consent (400)", async () => {
    const res = await start("noconsent@example.com", false);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("BAD_REQUEST");
  });

  it("starts in the intro phase once consent is given, recording consentAt", async () => {
    const res = await start("flow@example.com", true);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.attempt.phase).toBe("intro");
    expect(body.attempt.consentAt).not.toBeNull();
  });

  it("advances intro → items → wrap_up, rejecting invalid jumps", async () => {
    const session = (await start("walk@example.com", true)).json().sessionToken;
    const advance = (to: string) =>
      app.inject({
        method: "POST",
        url: "/v1/public/attempt/advance",
        headers: candidate(session),
        payload: { to },
      });

    const toItems = await advance("items");
    expect(toItems.statusCode).toBe(200);
    expect(toItems.json().phase).toBe("items");

    // Can't skip back to intro, jump to wrap_up's successor, or self-complete.
    expect((await advance("intro")).statusCode).toBe(400);
    expect((await advance("complete")).statusCode).toBe(400);

    const toWrap = await advance("wrap_up");
    expect(toWrap.statusCode).toBe(200);
    expect(toWrap.json().phase).toBe("wrap_up");
  });

  it("submit completes the session; advancing afterwards conflicts", async () => {
    const session = (await start("done@example.com", true)).json().sessionToken;
    await app.inject({
      method: "POST",
      url: "/v1/public/attempt/advance",
      headers: candidate(session),
      payload: { to: "items" },
    });

    const submit = await app.inject({
      method: "POST",
      url: "/v1/public/attempt/submit",
      headers: candidate(session),
    });
    expect(submit.statusCode).toBe(200);
    expect(submit.json().status).toBe("submitted");
    expect(submit.json().phase).toBe("complete");

    const after = await app.inject({
      method: "POST",
      url: "/v1/public/attempt/advance",
      headers: candidate(session),
      payload: { to: "items" },
    });
    expect(after.statusCode).toBe(409);
  });
});
