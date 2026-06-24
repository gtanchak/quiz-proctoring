import type { SessionEvent } from "@proctoring/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client.js";
import { createTestApp, type TestApp } from "./helpers/app.js";
import { type SeededKey, cleanupOrgs, seedOrgWithKey } from "./helpers/seed.js";

/**
 * Per-turn session event log / transcript (PRO-59, FR-23): a flow emits ordered,
 * timestamped events an admin can read back; the log is tenant-scoped.
 */
describe("session event log (/v1/attempts/:id/events)", () => {
  let app: TestApp;
  let tenant: SeededKey;
  let other: SeededKey;
  let attemptId: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createTestApp();
    tenant = await seedOrgWithKey("events");
    other = await seedOrgWithKey("events-other");

    const test = (
      await app.inject({
        method: "POST",
        url: "/v1/tests",
        headers: auth(tenant.token),
        payload: { title: "Events test", durationMinutes: 30 },
      })
    ).json();
    const questionId = (
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
      })
    ).json().id;
    await app.inject({
      method: "POST",
      url: `/v1/tests/${test.id}/publish`,
      headers: auth(tenant.token),
    });

    // Candidate flow: start → advance → answer → submit.
    const started = (
      await app.inject({
        method: "POST",
        url: `/v1/public/tests/${test.accessToken}/start`,
        payload: { candidateEmail: "c@example.com", consent: true },
      })
    ).json();
    attemptId = started.attempt.id;
    const session = started.sessionToken;
    await app.inject({
      method: "POST",
      url: "/v1/public/attempt/advance",
      headers: auth(session),
      payload: { to: "items" },
    });
    await app.inject({
      method: "PUT",
      url: "/v1/public/attempt/answers",
      headers: auth(session),
      payload: { answers: [{ questionId, selectedOptionIds: [] }] },
    });
    await app.inject({
      method: "POST",
      url: "/v1/public/attempt/submit",
      headers: auth(session),
    });
  });

  afterAll(async () => {
    await cleanupOrgs([tenant.orgId, other.orgId]);
    await app.close();
    await pool.end();
  });

  it("records the flow as an ordered, timestamped transcript", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/attempts/${attemptId}/events`,
      headers: auth(tenant.token),
    });
    expect(res.statusCode).toBe(200);
    const events = res.json() as SessionEvent[];
    expect(events.map((e) => e.type)).toEqual([
      "session_started",
      "phase_changed",
      "answers_saved",
      "session_completed",
    ]);
    // Phases tracked through the flow.
    expect(events[0].phase).toBe("intro");
    expect(events[1].phase).toBe("items");
    expect(events[3].phase).toBe("complete");
    expect(events[3].data).toMatchObject({ status: "submitted" });
    // Timestamps are non-decreasing.
    const times = events.map((e) => Date.parse(e.at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("is tenant-scoped: another tenant gets 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/attempts/${attemptId}/events`,
      headers: auth(other.token),
    });
    expect(res.statusCode).toBe(404);
  });
});
