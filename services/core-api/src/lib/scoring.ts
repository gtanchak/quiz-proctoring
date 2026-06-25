import type { ScoreResult, Scorer } from "@proctoring/shared";
import { type GradableMcq, gradeMcq } from "./grading.js";

export interface McqScorerInput {
  question: GradableMcq;
  selectedOptionIds: ReadonlyArray<string>;
}

/**
 * The deterministic MCQ scorer (PRO-60 reference implementation). Wraps the pure
 * `gradeMcq` rules into the universal {@link ScoreResult}. Confidence is always
 * 1 — MCQ is the genuinely 100%-accurate scoring path (no model, no judgement);
 * the AI agent's LLM-as-judge scorer (P2) will emit calibrated sub-1 confidence.
 */
export function scoreMcq(input: McqScorerInput): ScoreResult {
  const result = gradeMcq(input.question, input.selectedOptionIds);
  const justification =
    result.isCorrect
      ? "Selection exactly matches the correct option set."
      : result.awarded > 0
        ? "Selection partially matches the correct option set."
        : "Selection is incorrect or empty.";
  return {
    score: result.awarded,
    maxScore: result.max,
    justification,
    // The candidate's selected option ids back the deterministic score.
    evidence: [...input.selectedOptionIds],
    confidence: 1,
  };
}

/** The MCQ scorer as a {@link Scorer}, registered behind the engine contract. */
export const mcqScorer: Scorer<McqScorerInput> = {
  kind: "mcq",
  score: scoreMcq,
};
