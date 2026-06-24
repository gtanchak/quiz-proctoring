import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers/app.js";
import { db, pool } from "../src/db/client.js";
import { attempts } from "../src/db/schema/tests.js";
import { type SeededKey, cleanupOrgs, seedOrgWithKey } from "./helpers/seed.js";

interface QuestionSpec {
  type: "mcq_single" | "mcq_multiple";
  points: number;
  gradingMode?: "all_or_nothing" | "partial";
  negativeMarking?: boolean;
  options: { text: string; correct: boolean }[];
}

interface CreatedQuestion {
  id: string;
  correctOptionIds: string[];
  optionIds: string[];
}

describe("answer capture & auto-grading (end-to-end)", () => {
  let app: TestApp;
  let owner: SeededKey;

  const admin = () => ({ authorization: `Bearer ${owner.token}` });
  const sess = (t: string) => ({ authorization: `Bearer ${t}` });

  /** Builds a published test from the given question specs. */
  async function publishTest(
    specs: QuestionSpec[],
    durationMinutes?: number,
  ): Promise<{ token: string; testId: string; questions: CreatedQuestion[] }> {
    const t = (
      await app.inject({
        method: "POST",
        url: "/v1/tests",
        headers: admin(),
        payload: { title: "Graded", durationMinutes },
      })
    ).json();

    const questions: CreatedQuestion[] = [];
    for (const spec of specs) {
      const qRes = await app.inject({
        method: "POST",
        url: `/v1/tests/${t.id}/questions`,
        headers: admin(),
        payload: { prompt: "Question?", ...spec },
      });
      if (qRes.statusCode !== 201) {
        throw new Error(`question create ${qRes.statusCode}: ${qRes.payload}`);
      }
      const q = qRes.json();
      questions.push({
        id: q.id,
        optionIds: q.options.map((o: { id: string }) => o.id),
        correctOptionIds: q.options
          .filter((o: { correct: boolean }) => o.correct)
          .map((o: { id: string }) => o.id),
      });
    }

    await app.inject({
      method: "POST",
      url: `/v1/tests/${t.id}/publish`,
      headers: admin(),
    });
    return { token: t.accessToken, testId: t.id, questions };
  }

  async function startAttempt(token: string, email: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: `/v1/public/tests/${token}/start`,
      payload: { candidateEmail: email },
    });
    return res.json().sessionToken;
  }

  async function saveAnswers(
    session: string,
    answers: { questionId: string; selectedOptionIds: string[] }[],
  ) {
    return app.inject({
      method: "PUT",
      url: "/v1/public/attempt/answers",
      headers: sess(session),
      payload: { answers },
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    owner = await seedOrgWithKey("grading-owner");
  });

  afterAll(async () => {
    await cleanupOrgs([owner.orgId]);
    await app.close();
    await pool.end();
  });

  it("scores a correct single-answer attempt with full marks", async () => {
    const { token, questions } = await publishTest([
      {
        type: "mcq_single",
        points: 2,
        options: [
          { text: "Paris", correct: true },
          { text: "Lyon", correct: false },
        ],
      },
    ]);
    const session = await startAttempt(token, "a@example.com");
    await saveAnswers(session, [
      { questionId: questions[0].id, selectedOptionIds: questions[0].correctOptionIds },
    ]);
    const submit = await app.inject({
      method: "POST",
      url: "/v1/public/attempt/submit",
      headers: sess(session),
    });
    expect(submit.json()).toMatchObject({ status: "submitted", score: 2, maxScore: 2 });

    const result = await app.inject({
      method: "GET",
      url: "/v1/public/attempt/result",
      headers: sess(session),
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().breakdown[0]).toMatchObject({ points: 2, awardedPoints: 2 });
  });

  it("scores a wrong single-answer attempt as zero", async () => {
    const { token, questions } = await publishTest([
      {
        type: "mcq_single",
        points: 2,
        options: [
          { text: "Right", correct: true },
          { text: "Wrong", correct: false },
        ],
      },
    ]);
    const session = await startAttempt(token, "b@example.com");
    const wrongId = questions[0].optionIds.find(
      (id) => !questions[0].correctOptionIds.includes(id),
    )!;
    await saveAnswers(session, [
      { questionId: questions[0].id, selectedOptionIds: [wrongId] },
    ]);
    const submit = await app.inject({
      method: "POST",
      url: "/v1/public/attempt/submit",
      headers: sess(session),
    });
    expect(submit.json()).toMatchObject({ score: 0, maxScore: 2 });
  });

  it("gives proportional partial credit on a multi-correct question", async () => {
    const { token, questions } = await publishTest([
      {
        type: "mcq_multiple",
        points: 6,
        gradingMode: "partial",
        options: [
          { text: "a", correct: true },
          { text: "b", correct: true },
          { text: "c", correct: true },
          { text: "d", correct: false },
        ],
      },
    ]);
    const session = await startAttempt(token, "c@example.com");
    // 2 of 3 correct, weight 2 -> 4
    await saveAnswers(session, [
      {
        questionId: questions[0].id,
        selectedOptionIds: questions[0].correctOptionIds.slice(0, 2),
      },
    ]);
    const submit = await app.inject({
      method: "POST",
      url: "/v1/public/attempt/submit",
      headers: sess(session),
    });
    expect(submit.json()).toMatchObject({ score: 4, maxScore: 6 });
  });

  it("sums maxScore across questions; unanswered count as zero", async () => {
    const { token, questions } = await publishTest([
      { type: "mcq_single", points: 2, options: [ { text: "a", correct: true }, { text: "b", correct: false } ] },
      { type: "mcq_single", points: 3, options: [ { text: "a", correct: true }, { text: "b", correct: false } ] },
    ]);
    const session = await startAttempt(token, "d@example.com");
    // Answer only the first (correctly); leave the second blank.
    await saveAnswers(session, [
      { questionId: questions[0].id, selectedOptionIds: questions[0].correctOptionIds },
    ]);
    const submit = await app.inject({
      method: "POST",
      url: "/v1/public/attempt/submit",
      headers: sess(session),
    });
    expect(submit.json()).toMatchObject({ score: 2, maxScore: 5 });
  });

  it("rejects saving answers after the deadline, and auto-grades on expiry", async () => {
    const { token, questions } = await publishTest(
      [ { type: "mcq_single", points: 2, options: [ { text: "a", correct: true }, { text: "b", correct: false } ] } ],
      30,
    );
    const session = await startAttempt(token, "e@example.com");
    // Save a correct answer while still in progress.
    await saveAnswers(session, [
      { questionId: questions[0].id, selectedOptionIds: questions[0].correctOptionIds },
    ]);

    // Force the deadline into the past.
    await db
      .update(attempts)
      .set({ deadlineAt: new Date(Date.now() - 1000) })
      .where(eq(attempts.candidateEmail, "e@example.com"));

    // Saving now is rejected (attempt auto-expires).
    const late = await saveAnswers(session, [
      { questionId: questions[0].id, selectedOptionIds: [] },
    ]);
    expect(late.statusCode).toBe(409);

    // Auto-expiry graded the answer that was saved before the deadline.
    const result = await app.inject({
      method: "GET",
      url: "/v1/public/attempt/result",
      headers: sess(session),
    });
    expect(result.json()).toMatchObject({ status: "expired", score: 2, maxScore: 2 });
  });

  it("lets the admin read the per-question response breakdown", async () => {
    const { token, testId, questions } = await publishTest([
      { type: "mcq_single", points: 2, options: [ { text: "a", correct: true }, { text: "b", correct: false } ] },
    ]);
    const session = await startAttempt(token, "f@example.com");
    await saveAnswers(session, [
      { questionId: questions[0].id, selectedOptionIds: questions[0].correctOptionIds },
    ]);
    await app.inject({
      method: "POST",
      url: "/v1/public/attempt/submit",
      headers: sess(session),
    });

    const attemptList = await app.inject({
      method: "GET",
      url: `/v1/tests/${testId}/attempts`,
      headers: admin(),
    });
    const attemptId = attemptList.json().data[0].id;

    const breakdown = await app.inject({
      method: "GET",
      url: `/v1/attempts/${attemptId}/responses`,
      headers: admin(),
    });
    expect(breakdown.statusCode).toBe(200);
    expect(breakdown.json()[0]).toMatchObject({
      questionId: questions[0].id,
      awardedPoints: 2,
    });
  });
});
