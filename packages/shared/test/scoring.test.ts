import { describe, expect, it } from "vitest";
import {
  type CompetencyScore,
  aggregateCompetencies,
  isLowConfidence,
  recommendationBand,
} from "../src/scoring/index.js";

const comp = (over: Partial<CompetencyScore> = {}): CompetencyScore => ({
  key: "c",
  score: 5,
  maxScore: 10,
  weight: 1,
  confidence: 1,
  ...over,
});

describe("recommendationBand", () => {
  it("maps percentages to bands at the default thresholds", () => {
    expect(recommendationBand(90)).toBe("strong");
    expect(recommendationBand(75)).toBe("strong"); // inclusive
    expect(recommendationBand(74.9)).toBe("possible");
    expect(recommendationBand(50)).toBe("possible"); // inclusive
    expect(recommendationBand(49.9)).toBe("weak");
    expect(recommendationBand(0)).toBe("weak");
  });

  it("honours custom thresholds", () => {
    expect(recommendationBand(60, { strong: 60, possible: 30 })).toBe("strong");
  });
});

describe("isLowConfidence", () => {
  it("flags below the threshold (FR-26)", () => {
    expect(isLowConfidence(0.59)).toBe(true);
    expect(isLowConfidence(0.6)).toBe(false);
    expect(isLowConfidence(0.4, 0.3)).toBe(false);
  });
});

describe("aggregateCompetencies", () => {
  it("computes a weight-normalised percentage and band (FR-25/FR-28)", () => {
    const agg = aggregateCompetencies([
      comp({ key: "a", score: 9, maxScore: 10, weight: 3 }), // 90%
      comp({ key: "b", score: 5, maxScore: 10, weight: 1 }), // 50%
    ]);
    // (3*0.9 + 1*0.5) / 4 = 0.8 → 80%
    expect(agg.percent).toBe(80);
    expect(agg.band).toBe("strong");
    expect(agg.score).toBe(14);
    expect(agg.maxScore).toBe(20);
  });

  it("takes aggregate confidence as the weakest competency and flags low ones", () => {
    const agg = aggregateCompetencies([
      comp({ confidence: 0.9 }),
      comp({ confidence: 0.5 }),
    ]);
    expect(agg.confidence).toBe(0.5);
    expect(agg.lowConfidence).toBe(true);
  });

  it("ignores zero-weight competencies but still sums raw score/max", () => {
    const agg = aggregateCompetencies([
      comp({ key: "graded", score: 8, maxScore: 10, weight: 1 }),
      comp({ key: "ungraded", score: 0, maxScore: 5, weight: 0, confidence: 0.1 }),
    ]);
    expect(agg.percent).toBe(80); // only the weighted one counts
    expect(agg.confidence).toBe(1); // zero-weight's low confidence ignored
    expect(agg.maxScore).toBe(15); // raw totals still include both
  });

  it("handles an empty / all-zero-weight set without dividing by zero", () => {
    expect(aggregateCompetencies([]).percent).toBe(0);
    expect(aggregateCompetencies([]).band).toBe("weak");
    expect(aggregateCompetencies([comp({ weight: 0 })]).percent).toBe(0);
  });
});
