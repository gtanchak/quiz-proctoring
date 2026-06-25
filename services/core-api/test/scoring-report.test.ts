import type { AttemptEvaluation, CompetencyScore } from "@proctoring/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client.js";
import { setViolationsClient } from "../src/lib/violations-client.js";
import { createTestApp, type TestApp } from "./helpers/app.js";
import { type SeededKey, cleanupOrgs, seedOrgWithKey } from "./helpers/seed.js";

/**
 * Competency-aggregated evaluation on the report + human override (PRO-60
 * slice 2). Two competencies, one answered correctly and one not → 50% →
 * "possible"; a recruiter can override the band, audited.
 */
describe("attempt evaluation & recommendation override", () => {
  let app: TestApp;
  let tenant: SeededKey;
  let attemptId: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  const findComp = (e: AttemptEvaluation, key: string): CompetencyScore | undefined =>
    e.competencies.find((c) => c.key === key);

  beforeAll(async () => {
    app = await createTestApp();
    setViolationsClient({ async listForAttempt() { return []; } });
    tenant = await seedOrgWithKey("scoring");

    const test = (
      await app.inject({
        method: "POST",
        url: "/v1/tests",
        headers: auth(tenant.token),
        payload: { title: "Scored test", durationMinutes: 30 },
      })
    ).json();

    const addQ = async (competency: string) =>
      (
        await app.inject({
          method: "POST",
          url: `/v1/tests/${test.id}/questions`,
          headers: auth(tenant.token),
          payload: {
            type: "mcq_single",
            prompt: competency,
            points: 10,
            competency,
            options: [
              { text: "right", correct: true },
              { text: "wrong", correct: false },
            ],
          },
        })
      ).json();
    const q1 = await addQ("algebra");
    await addQ("geometry");
    const q1Correct = q1.options.find(
      (o: { correct: boolean }) => o.correct,
    ).id;

    await app.inject({
      method: "POST",
      url: `/v1/tests/${test.id}/publish`,
      headers: auth(tenant.token),
    });

    const session = (
      await app.inject({
        method: "POST",
        url: `/v1/public/tests/${test.accessToken}/start`,
        payload: { candidateEmail: "c@example.com", consent: true },
      })
    ).json().sessionToken;
    attemptId = (
      await app.inject({
        method: "GET",
        url: "/v1/public/attempt",
        headers: auth(session),
      })
    ).json().id;

    // Answer algebra correctly; leave geometry unanswered (0).
    await app.inject({
      method: "PUT",
      url: "/v1/public/attempt/answers",
      headers: auth(session),
      payload: { answers: [{ questionId: q1.id, selectedOptionIds: [q1Correct] }] },
    });
    await app.inject({
      method: "POST",
      url: "/v1/public/attempt/submit",
      headers: auth(session),
    });
  });

  afterAll(async () => {
    setViolationsClient(null);
    await cleanupOrgs([tenant.orgId]);
    await app.close();
    await pool.end();
  });

  it("reports a competency-aggregated evaluation with an advisory band", async () => {
    const report = (
      await app.inject({
        method: "GET",
        url: `/v1/attempts/${attemptId}/report`,
        headers: auth(tenant.token),
      })
    ).json();
    const evaluation = report.evaluation as AttemptEvaluation;
    expect(findComp(evaluation, "algebra")).toMatchObject({ score: 10, maxScore: 10 });
    expect(findComp(evaluation, "geometry")).toMatchObject({ score: 0, maxScore: 10 });
    expect(evaluation.percent).toBe(50);
    expect(evaluation.band).toBe("possible");
    expect(evaluation.confidence).toBe(1);
    expect(evaluation.lowConfidence).toBe(false);
    expect(evaluation.override).toBeNull();
  });

  it("records a human override of the band (advisory, audited)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/attempts/${attemptId}/recommendation`,
      headers: auth(tenant.token),
      payload: { band: "strong", note: "Strong interview signal" },
    });
    expect(res.statusCode).toBe(200);
    const evaluation = res.json() as AttemptEvaluation;
    // Computed band stays advisory; the override is recorded alongside it.
    expect(evaluation.band).toBe("possible");
    expect(evaluation.override).toEqual({
      band: "strong",
      note: "Strong interview signal",
    });

    // Reflected on the next report read.
    const report = (
      await app.inject({
        method: "GET",
        url: `/v1/attempts/${attemptId}/report`,
        headers: auth(tenant.token),
      })
    ).json();
    expect(report.evaluation.override.band).toBe("strong");
  });
});
