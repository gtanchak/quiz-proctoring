/**
 * MCQ auto-grading — a pure module (no I/O) so it is trivially unit-testable and
 * reusable by the eventual submission flow. This is the reference grading
 * interface other question types will follow.
 *
 * Rules:
 * - **No selection** scores 0 with no penalty.
 * - **Single-correct** (and any question with `all_or_nothing`): full points iff
 *   the selected set exactly equals the correct set; otherwise 0, or `-points`
 *   when negative marking is on.
 * - **Multi-correct `partial`**: each option carries a weight of
 *   `points / |correct|`. Correctly selected options earn their weight; with
 *   negative marking, incorrectly selected options deduct the same weight. The
 *   result is clamped to `[0, points]` (or `[-points, points]` with negative
 *   marking). Full marks require exactly the correct set.
 */

export type McqType = "mcq_single" | "mcq_multiple";
export type GradingMode = "all_or_nothing" | "partial";

export interface GradableMcq {
  type: McqType;
  points: number;
  gradingMode: GradingMode;
  negativeMarking: boolean;
  options: ReadonlyArray<{ id: string }>;
  correctOptionIds: ReadonlyArray<string>;
}

export interface GradeResult {
  awarded: number;
  max: number;
  isCorrect: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function gradeMcq(
  question: GradableMcq,
  selectedOptionIds: ReadonlyArray<string>,
): GradeResult {
  const max = question.points;
  const correct = new Set(question.correctOptionIds);
  const validIds = new Set(question.options.map((o) => o.id));
  // Ignore selections that aren't real options of this question.
  const selected = new Set(
    selectedOptionIds.filter((id) => validIds.has(id)),
  );

  if (selected.size === 0) {
    return { awarded: 0, max, isCorrect: false };
  }

  let correctSelected = 0;
  let incorrectSelected = 0;
  for (const id of selected) {
    if (correct.has(id)) {
      correctSelected += 1;
    } else {
      incorrectSelected += 1;
    }
  }
  const isExact =
    correctSelected === correct.size && incorrectSelected === 0;

  if (question.type === "mcq_single" || question.gradingMode === "all_or_nothing") {
    if (isExact) {
      return { awarded: max, max, isCorrect: true };
    }
    return {
      awarded: question.negativeMarking ? -max : 0,
      max,
      isCorrect: false,
    };
  }

  // Multi-correct, partial credit.
  const totalCorrect = correct.size || 1;
  const weight = max / totalCorrect;
  const raw =
    weight * correctSelected -
    (question.negativeMarking ? weight * incorrectSelected : 0);
  const floor = question.negativeMarking ? -max : 0;
  const awarded = Math.max(floor, Math.min(max, raw));

  return { awarded: round2(awarded), max, isCorrect: isExact };
}
