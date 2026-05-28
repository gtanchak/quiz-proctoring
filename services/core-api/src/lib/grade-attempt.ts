import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  attempts,
  type AttemptRow,
  questions,
  responses,
} from "../db/schema/tests.js";
import { type GradableMcq, gradeMcq } from "./grading.js";

/**
 * Grades an attempt from its saved responses and records the result: each
 * response's `awardedPoints`, and the attempt's total `score` / `maxScore` /
 * `gradedAt`. Pure scoring lives in `gradeMcq`; this just loads, applies, and
 * persists. Unanswered questions contribute 0 to the score but still count
 * toward `maxScore`. Called when an attempt is finalized (submit or expiry).
 */
export async function gradeAttempt(attempt: AttemptRow): Promise<AttemptRow> {
  const [qs, rs] = await Promise.all([
    db.select().from(questions).where(eq(questions.testId, attempt.testId)),
    db.select().from(responses).where(eq(responses.attemptId, attempt.id)),
  ]);

  const byQuestion = new Map(qs.map((q) => [q.id, q]));
  const maxScore = qs.reduce((sum, q) => sum + q.points, 0);

  let score = 0;
  for (const response of rs) {
    const question = byQuestion.get(response.questionId);
    if (!question) {
      continue;
    }
    const gradable: GradableMcq = {
      type: question.type,
      points: question.points,
      gradingMode: question.gradingMode,
      negativeMarking: question.negativeMarking,
      options: question.options,
      correctOptionIds: question.correctOptionIds,
    };
    const result = gradeMcq(gradable, response.selectedOptionIds);
    score += result.awarded;
    await db
      .update(responses)
      .set({ awardedPoints: result.awarded, updatedAt: new Date() })
      .where(eq(responses.id, response.id));
  }

  score = Math.round(score * 100) / 100;
  const [updated] = await db
    .update(attempts)
    .set({ score, maxScore, gradedAt: new Date() })
    .where(eq(attempts.id, attempt.id))
    .returning();
  return updated ?? attempt;
}
