import {
  type AggregateScore,
  type BandThresholds,
  type CompetencyScore,
  DEFAULT_BAND_THRESHOLDS,
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  type RecommendationBand,
} from "./types.js";

/** Maps a percentage to a recommendation band (FR-28). Advisory only. */
export function recommendationBand(
  percent: number,
  thresholds: BandThresholds = DEFAULT_BAND_THRESHOLDS,
): RecommendationBand {
  if (percent >= thresholds.strong) return "strong";
  if (percent >= thresholds.possible) return "possible";
  return "weak";
}

/** Whether a confidence value is low enough to flag for human review (FR-26). */
export function isLowConfidence(
  confidence: number,
  threshold: number = DEFAULT_LOW_CONFIDENCE_THRESHOLD,
): boolean {
  return confidence < threshold;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Competency-based aggregation with configurable weights (FR-25). The headline
 * `percent` is the weight-normalised average of each competency's
 * `score / maxScore`; the band derives from it. Aggregate confidence is the
 * **lowest** competency confidence (a result is only as trustworthy as its
 * weakest part), and `lowConfidence` flags it for review.
 *
 * Zero-`maxScore` competencies contribute 0% (an empty competency can't earn
 * credit) but still carry their weight, so they pull the average down — make
 * weights reflect intent. Competencies with `weight = 0` are ignored.
 */
export function aggregateCompetencies(
  competencies: CompetencyScore[],
  thresholds: BandThresholds = DEFAULT_BAND_THRESHOLDS,
): AggregateScore {
  const weighted = competencies.filter((c) => c.weight > 0);
  const totalWeight = weighted.reduce((s, c) => s + c.weight, 0);

  const score = round2(competencies.reduce((s, c) => s + c.score, 0));
  const maxScore = round2(competencies.reduce((s, c) => s + c.maxScore, 0));

  const percent =
    totalWeight === 0
      ? 0
      : round2(
          (weighted.reduce((s, c) => {
            const ratio = c.maxScore > 0 ? c.score / c.maxScore : 0;
            return s + c.weight * ratio;
          }, 0) /
            totalWeight) *
            100,
        );

  const confidence = weighted.length
    ? Math.min(...weighted.map((c) => c.confidence))
    : 1;

  return {
    score,
    maxScore,
    percent,
    band: recommendationBand(percent, thresholds),
    competencies,
    confidence: round2(confidence),
    lowConfidence: isLowConfidence(confidence),
  };
}
