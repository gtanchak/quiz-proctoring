import { Type, type Static } from "@sinclair/typebox";

/**
 * Pluggable scoring & evaluation framework (PRO-60). The engine owns
 * aggregation, banding, and reporting; each **assessment type** supplies its own
 * scorer (MCQ = deterministic, AI agent = LLM-as-judge) that emits the one
 * universal {@link ScoreResult} shape. Defined once here so every type, the
 * reporting layer, and both web apps agree on it (ADR 0002).
 *
 * Evaluation accuracy is a *system* property (grounding + calibration +
 * human-in-the-loop), never "100% accurate" — only the MCQ scorer is genuinely
 * deterministic. Bands are advisory; nothing here auto-rejects a candidate
 * (FR-28, CLAUDE.md §1).
 */

/** The universal scorer output: a score plus the evidence to justify it. */
export const ScoreResultSchema = Type.Object(
  {
    score: Type.Number({ description: "Points awarded." }),
    maxScore: Type.Number({ description: "Points possible." }),
    /** Human-readable rationale (a rubric line for MCQ; the judge's reasoning for AI). */
    justification: Type.String(),
    /** References backing the score: response ids, transcript excerpts, rubric refs. */
    evidence: Type.Array(Type.String()),
    /** 0–1 confidence. Deterministic scorers (MCQ) are always 1. */
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);
export type ScoreResult = Static<typeof ScoreResultSchema>;

/**
 * A scorer for one assessment type. Generic over its input (an MCQ question +
 * selection, an AI turn + rubric, …). The engine only depends on `ScoreResult`.
 */
export interface Scorer<TInput> {
  readonly kind: string;
  score(input: TInput): ScoreResult | Promise<ScoreResult>;
}

/** One competency's contribution to the overall result (FR-25). */
export const CompetencyScoreSchema = Type.Object(
  {
    key: Type.String({ description: "Stable competency id/name." }),
    score: Type.Number(),
    maxScore: Type.Number(),
    /** Relative weight in the aggregate; need not sum to 1 (normalised on aggregate). */
    weight: Type.Number({ minimum: 0 }),
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);
export type CompetencyScore = Static<typeof CompetencyScoreSchema>;

/**
 * Advisory recommendation bands (FR-28). Ordered strongest-first. Never a
 * verdict: a human always decides — the band only summarises evidence.
 */
export const RECOMMENDATION_BANDS = ["strong", "possible", "weak"] as const;
export type RecommendationBand = (typeof RECOMMENDATION_BANDS)[number];
export const RecommendationBandSchema = Type.Union(
  RECOMMENDATION_BANDS.map((b) => Type.Literal(b)),
);

/** Percentage cut-offs for the bands: `>= strong` → strong, `>= possible` → possible. */
export interface BandThresholds {
  strong: number;
  possible: number;
}
export const DEFAULT_BAND_THRESHOLDS: BandThresholds = {
  strong: 75,
  possible: 50,
};

/** Below this confidence, a result is flagged for human review (FR-26). */
export const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.6;

/** The aggregated, banded result for a whole attempt. */
export const AggregateScoreSchema = Type.Object(
  {
    score: Type.Number(),
    maxScore: Type.Number(),
    /** Weighted percentage 0–100; the headline figure the band derives from. */
    percent: Type.Number({ minimum: 0, maximum: 100 }),
    band: RecommendationBandSchema,
    competencies: Type.Array(CompetencyScoreSchema),
    /** Aggregate confidence (the lowest competency confidence — weakest link). */
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
    /** True when confidence is below the review threshold (FR-26). */
    lowConfidence: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type AggregateScore = Static<typeof AggregateScoreSchema>;
