import { describe, expect, it } from "vitest";
import { type GradableMcq, gradeMcq } from "../src/lib/grading.js";

const opts = (...ids: string[]) => ids.map((id) => ({ id }));

const single = (over: Partial<GradableMcq> = {}): GradableMcq => ({
  type: "mcq_single",
  points: 4,
  gradingMode: "all_or_nothing",
  negativeMarking: false,
  options: opts("a", "b", "c", "d"),
  correctOptionIds: ["b"],
  ...over,
});

const multi = (over: Partial<GradableMcq> = {}): GradableMcq => ({
  type: "mcq_multiple",
  points: 6,
  gradingMode: "partial",
  negativeMarking: false,
  options: opts("a", "b", "c", "d"),
  correctOptionIds: ["a", "b", "c"],
  ...over,
});

describe("gradeMcq — single correct", () => {
  it("awards full points for the correct option", () => {
    expect(gradeMcq(single(), ["b"])).toEqual({
      awarded: 4,
      max: 4,
      isCorrect: true,
    });
  });

  it("scores 0 for a wrong option (no negative marking)", () => {
    expect(gradeMcq(single(), ["a"])).toMatchObject({
      awarded: 0,
      isCorrect: false,
    });
  });

  it("applies negative marking for a wrong option", () => {
    expect(gradeMcq(single({ negativeMarking: true }), ["a"])).toMatchObject({
      awarded: -4,
      isCorrect: false,
    });
  });

  it("scores 0 with no penalty when nothing is selected", () => {
    expect(gradeMcq(single({ negativeMarking: true }), [])).toMatchObject({
      awarded: 0,
      isCorrect: false,
    });
  });

  it("treats selecting multiple on a single-correct question as wrong", () => {
    expect(gradeMcq(single(), ["a", "b"])).toMatchObject({ awarded: 0 });
  });
});

describe("gradeMcq — multi correct, all_or_nothing", () => {
  const q = multi({ gradingMode: "all_or_nothing" });

  it("awards full points only for the exact correct set", () => {
    expect(gradeMcq(q, ["a", "b", "c"])).toMatchObject({
      awarded: 6,
      isCorrect: true,
    });
  });

  it("scores 0 for a partial-but-incomplete selection", () => {
    expect(gradeMcq(q, ["a", "b"])).toMatchObject({
      awarded: 0,
      isCorrect: false,
    });
  });
});

describe("gradeMcq — multi correct, partial", () => {
  it("gives proportional credit for correct picks", () => {
    // 2 of 3 correct, weight = 6/3 = 2 → 4
    expect(gradeMcq(multi(), ["a", "b"])).toMatchObject({
      awarded: 4,
      isCorrect: false,
    });
  });

  it("awards full points (and isCorrect) for the exact set", () => {
    expect(gradeMcq(multi(), ["a", "b", "c"])).toMatchObject({
      awarded: 6,
      isCorrect: true,
    });
  });

  it("does not penalize wrong picks without negative marking (clamped at 0)", () => {
    // all 3 correct selected (+6) plus the wrong 'd'; no penalty → clamp to 6
    expect(gradeMcq(multi(), ["a", "b", "c", "d"])).toMatchObject({
      awarded: 6,
    });
  });

  it("penalizes wrong picks with negative marking", () => {
    // +2 (a) - 2 (d) = 0
    expect(
      gradeMcq(multi({ negativeMarking: true }), ["a", "d"]),
    ).toMatchObject({ awarded: 0 });
  });

  it("floors at -points with negative marking", () => {
    // selecting only wrong-ish: a correct (+2) but two wrong... only 'd' wrong exists
    // pick d only: 0 correct - 2 = -2
    expect(
      gradeMcq(multi({ negativeMarking: true }), ["d"]),
    ).toMatchObject({ awarded: -2 });
  });

  it("ignores option ids that are not part of the question", () => {
    expect(gradeMcq(multi(), ["a", "b", "zzz"])).toMatchObject({ awarded: 4 });
  });
});
