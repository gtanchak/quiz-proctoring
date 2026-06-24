import type { SessionEvent } from "@proctoring/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client.js";
import { createTestApp, type TestApp } from "./helpers/app.js";
import { type SeededKey, cleanupOrgs, seedOrgWithKey } from "./helpers/seed.js";

/**
 * Device-check gating by modality (FR-12), visible progress + time remaining
 * (FR-16), and reconnection/resume (FR-17).
 */
describe("session device-check, progress & resume (/v1/public)", () => {
  let app: TestApp;
  let tenant: SeededKey;
  let token: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createTestApp();
    tenant = await seedOrgWithKey("progress");

    const test = (
      await app.inject({
        method: "POST",
        url: "/v1/tests",
        headers: auth(tenant.token),
        payload: {
          title: "Proctored test",
          durationMinutes: 30,
          // Camera-gated modality: candidate must pass a camera device check.
          proctoring: { camera: true, microphone: false, screen: false },
        },
      })
    ).json();
    token = test.accessToken;
    await app.inject({
      method: "POST",
      url: `/v1/tests/${test.id}/questions`,
      headers: auth(tenant.token),
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
      headers: auth(tenant.token),
    });
  });

  afterAll(async () => {
    await cleanupOrgs([tenant.orgId]);
    await app.close();
    await pool.end();
  });

  it("exposes device-check requirements on the landing, gated by modality", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/public/tests/${token}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deviceCheck).toEqual({
      camera: true,
      microphone: false,
      screen: false,
    });
  });

  it("reports progress with server-authoritative time remaining", async () => {
    const session = (
      await app.inject({
        method: "POST",
        url: `/v1/public/tests/${token}/start`,
        payload: { candidateEmail: "prog@example.com", consent: true },
      })
    ).json().sessionToken;

    const res = await app.inject({
      method: "GET",
      url: "/v1/public/attempt/progress",
      headers: auth(session),
    });
    expect(res.statusCode).toBe(200);
    const progress = res.json();
    expect(progress.phase).toBe("intro");
    expect(progress.answered).toBe(0);
    expect(progress.total).toBe(1);
    expect(progress.remainingMs).toBeGreaterThan(0);
    expect(progress.remainingMs).toBeLessThanOrEqual(30 * 60_000);
  });

  it("resumes an in-progress attempt on reconnect, logging session_resumed", async () => {
    const email = "reconnect@example.com";
    const first = (
      await app.inject({
        method: "POST",
        url: `/v1/public/tests/${token}/start`,
        payload: { candidateEmail: email, consent: true },
      })
    ).json();
    const attemptId = first.attempt.id;

    // Reconnect: starting again for the same candidate resumes (new token).
    const resumed = await app.inject({
      method: "POST",
      url: `/v1/public/tests/${token}/start`,
      payload: { candidateEmail: email, consent: true },
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().resumed).toBe(true);

    const events = (
      await app.inject({
        method: "GET",
        url: `/v1/attempts/${attemptId}/events`,
        headers: auth(tenant.token),
      })
    ).json() as SessionEvent[];
    expect(events.map((e) => e.type)).toContain("session_resumed");
  });
});
