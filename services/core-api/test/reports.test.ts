import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers/app.js";
import { db, pool } from "../src/db/client.js";
import { type AttemptRow, attempts } from "../src/db/schema/tests.js";
import { AppError } from "../src/lib/errors.js";
import {
  type IngestedViolation,
  type ViolationsClient,
  setViolationsClient,
} from "../src/lib/violations-client.js";
import { type SeededKey, cleanupOrgs, seedOrgWithKey } from "./helpers/seed.js";

const T0 = new Date("2026-06-01T12:00:00.000Z");

/** Stub violation log: returns a settable timeline, or fails on demand. */
let timeline: IngestedViolation[] = [];
let failMode = false;
const stubClient: ViolationsClient = {
  async listForAttempt() {
    if (failMode) throw AppError.badGateway("violation log unavailable");
    return timeline;
  },
};

function violation(
  offsetMs: number,
  over: Partial<IngestedViolation> = {},
): IngestedViolation {
  const startedAt = new Date(T0.getTime() + offsetMs).toISOString();
  return {
    id: crypto.randomUUID(),
    attemptId: "00000000-0000-0000-0000-000000000000",
    type: "tab_switch",
    severity: "medium",
    schemaVersion: 1,
    startedAt,
    endedAt: null,
    durationMs: null,
    evidenceIds: [],
    metadata: null,
    ...over,
  };
}

describe("per-attempt report (/v1/attempts/:id/report)", () => {
  let app: TestApp;
  let ownerA: SeededKey;
  let ownerB: SeededKey;
  let testId: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  /** Starts an attempt on the shared published test, then patches its row. */
  async function seedAttempt(patch: Partial<AttemptRow>): Promise<string> {
    const started = await app.inject({
      method: "POST",
      url: `/v1/tests/${testId}/attempts`,
      headers: auth(ownerA.token),
      payload: { candidateEmail: "c@example.com" },
    });
    const id = started.json().id as string;
    await db.update(attempts).set(patch).where(eq(attempts.id, id));
    return id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    setViolationsClient(stubClient);
    ownerA = await seedOrgWithKey("report-owner-a");
    ownerB = await seedOrgWithKey("report-owner-b");

    const t = (
      await app.inject({
        method: "POST",
        url: "/v1/tests",
        headers: auth(ownerA.token),
        payload: { title: "Algebra I", durationMinutes: 60 },
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
    testId = t.id;
  });

  beforeEach(() => {
    timeline = [];
    failMode = false;
  });

  afterAll(async () => {
    setViolationsClient(null);
    await cleanupOrgs([ownerA.orgId, ownerB.orgId]);
    await app.close();
    await pool.end();
  });

  it("assembles summary + a chronological timeline with offsets", async () => {
    const id = await seedAttempt({
      status: "submitted",
      startedAt: T0,
      submittedAt: new Date(T0.getTime() + 30 * 60_000),
      score: 7,
      maxScore: 10,
    });
    // Out of order, plus one event before start (offset must clamp to 0).
    timeline = [
      violation(5 * 60_000, { durationMs: 4_000, evidenceIds: ["ev1"] }),
      violation(1 * 60_000, { type: "fullscreen_exit", severity: "low" }),
      violation(-2_000), // clock skew before start
    ];

    const res = await app.inject({
      method: "GET",
      url: `/v1/attempts/${id}/report`,
      headers: auth(ownerA.token),
    });
    expect(res.statusCode).toBe(200);
    const report = res.json();

    expect(report.attempt).toMatchObject({
      id,
      status: "submitted",
      terminationReason: null,
      score: 7,
      maxScore: 10,
      durationUsedMs: 30 * 60_000,
    });
    expect(report.test).toMatchObject({ title: "Algebra I", durationMinutes: 60 });
    expect(report.violationCount).toBe(3);

    // Chronological, with offset from attempt start (clamped at 0).
    expect(report.timeline.map((v: { offsetMs: number }) => v.offsetMs)).toEqual([
      0,
      60_000,
      300_000,
    ]);
    expect(report.timeline[1].type).toBe("fullscreen_exit");
    expect(report.timeline[2].evidenceIds).toEqual(["ev1"]);
  });

  it("reports the reason for an auto-terminated (expired) attempt", async () => {
    const id = await seedAttempt({
      status: "expired",
      startedAt: T0,
      submittedAt: new Date(T0.getTime() + 60 * 60_000),
    });

    const report = (
      await app.inject({
        method: "GET",
        url: `/v1/attempts/${id}/report`,
        headers: auth(ownerA.token),
      })
    ).json();

    expect(report.attempt.status).toBe("expired");
    expect(report.attempt.terminationReason).toBe("deadline_reached");
    expect(report.timeline).toEqual([]);
  });

  it("scopes the report to the owner — another org gets 404", async () => {
    const id = await seedAttempt({ status: "submitted", startedAt: T0 });
    const res = await app.inject({
      method: "GET",
      url: `/v1/attempts/${id}/report`,
      headers: auth(ownerB.token),
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for an unknown attempt id", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/attempts/${crypto.randomUUID()}/report`,
      headers: auth(ownerA.token),
    });
    expect(res.statusCode).toBe(404);
  });

  it("surfaces a 502 when the violation log service fails", async () => {
    const id = await seedAttempt({ status: "submitted", startedAt: T0 });
    failMode = true;
    const res = await app.inject({
      method: "GET",
      url: `/v1/attempts/${id}/report`,
      headers: auth(ownerA.token),
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("BAD_GATEWAY");
  });

  it("requires authentication", async () => {
    const id = await seedAttempt({ status: "submitted", startedAt: T0 });
    const res = await app.inject({
      method: "GET",
      url: `/v1/attempts/${id}/report`,
    });
    expect(res.statusCode).toBe(401);
  });
});
