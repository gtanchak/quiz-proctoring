/**
 * Server-authoritative test timer — a pure function over the attempt's stored
 * deadline and the *server's* current time. The client clock is never an input,
 * so a candidate cannot gain time by manipulating it, and a refresh or brief
 * disconnect resumes from true elapsed time (the deadline doesn't move).
 */

export interface TimerInput {
  /** Absolute expiry instant, or null for an untimed attempt. */
  deadlineAt: Date | null;
}

export interface TimerState {
  /** Milliseconds left (clamped at 0), or null when untimed. */
  remainingMs: number | null;
  /** True once the deadline has passed (always false when untimed). */
  expired: boolean;
}

export function timerState(
  attempt: TimerInput,
  now: Date = new Date(),
): TimerState {
  if (!attempt.deadlineAt) {
    return { remainingMs: null, expired: false };
  }
  const remaining = attempt.deadlineAt.getTime() - now.getTime();
  return { remainingMs: Math.max(0, remaining), expired: remaining <= 0 };
}

/** Computes the deadline for a freshly started attempt, or null if untimed. */
export function computeDeadline(
  startedAt: Date,
  durationMinutes: number | null,
): Date | null {
  if (!durationMinutes) {
    return null;
  }
  return new Date(startedAt.getTime() + durationMinutes * 60_000);
}
