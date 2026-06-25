import { describe, expect, it } from "vitest";
import type { GradableMcq } from "../src/lib/grading.js";
import { mcqScorer, scoreMcq } from "../src/lib/scoring.js";

const single: GradableMcq = {
  type: "mcq_single",
  points: 10,
  gradingMode: "all_or_nothing",
  negativeMarking: false,
  options: [{ id: "a" }, { id: "b" }],
  correctOptionIds: ["a"],
};

describe("mcq scorer (deterministic ScoreResult adapter)", () => {
  it("emits a full-score ScoreResult with confidence 1 for a correct answer", () => {
    const r = scoreMcq({ question: single, selectedOptionIds: ["a"] });
    expect(r).toMatchObject({ score: 10, maxScore: 10, confidence: 1 });
    expect(r.evidence).toEqual(["a"]);
    expect(r.justification).toMatch(/exactly matches/i);
  });

  it("scores an incorrect answer 0 with confidence 1 (deterministic)", () => {
    const r = scoreMcq({ question: single, selectedOptionIds: ["b"] });
    expect(r).toMatchObject({ score: 0, maxScore: 10, confidence: 1 });
    expect(r.justification).toMatch(/incorrect or empty/i);
  });

  it("is exposed as a Scorer behind the engine contract", () => {
    expect(mcqScorer.kind).toBe("mcq");
    expect(mcqScorer.score({ question: single, selectedOptionIds: ["a"] })).toMatchObject(
      { score: 10, confidence: 1 },
    );
  });
});
