import { describe, expect, it } from "vitest";
import { computeDeadline, timerState } from "../src/lib/timer.js";

describe("timerState", () => {
  const now = new Date("2026-06-01T12:00:00.000Z");

  it("reports untimed attempts as never-expiring", () => {
    expect(timerState({ deadlineAt: null }, now)).toEqual({
      remainingMs: null,
      expired: false,
    });
  });

  it("computes remaining time from a future deadline", () => {
    const deadlineAt = new Date(now.getTime() + 60_000);
    expect(timerState({ deadlineAt }, now)).toEqual({
      remainingMs: 60_000,
      expired: false,
    });
  });

  it("clamps to 0 and marks expired once the deadline passes", () => {
    const deadlineAt = new Date(now.getTime() - 1);
    expect(timerState({ deadlineAt }, now)).toEqual({
      remainingMs: 0,
      expired: true,
    });
  });

  it("is reconnect-safe: same deadline, later 'now' yields less time, not a reset", () => {
    const deadlineAt = new Date(now.getTime() + 300_000);
    const first = timerState({ deadlineAt }, now);
    const later = timerState(
      { deadlineAt },
      new Date(now.getTime() + 120_000),
    );
    expect(first.remainingMs).toBe(300_000);
    expect(later.remainingMs).toBe(180_000);
  });
});

describe("computeDeadline", () => {
  const start = new Date("2026-06-01T12:00:00.000Z");

  it("returns null for an untimed test", () => {
    expect(computeDeadline(start, null)).toBeNull();
    expect(computeDeadline(start, 0)).toBeNull();
  });

  it("adds the duration in minutes", () => {
    expect(computeDeadline(start, 90)?.toISOString()).toBe(
      "2026-06-01T13:30:00.000Z",
    );
  });
});
