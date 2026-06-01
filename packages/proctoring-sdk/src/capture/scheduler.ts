/** Hard floor so a high jitter ratio can never schedule a near-zero interval. */
export const MIN_SNAPSHOT_INTERVAL_MS = 250;

/**
 * Picks the delay until the next snapshot. Intervals are deliberately
 * *randomized* around the configured average so a candidate cannot predict (and
 * game) capture timing — fixed intervals defeat the purpose (see PRO-15 note).
 *
 * The result is uniform in `[avg*(1-jitter), avg*(1+jitter)]`, floored at
 * {@link MIN_SNAPSHOT_INTERVAL_MS}. `jitter` of 0 yields a fixed interval.
 */
export function nextSnapshotDelay(
  averageIntervalMs: number,
  jitterRatio: number,
  random: () => number = Math.random,
): number {
  const spread = averageIntervalMs * jitterRatio;
  const delta = (random() * 2 - 1) * spread; // uniform in [-spread, spread]
  return Math.max(
    MIN_SNAPSHOT_INTERVAL_MS,
    Math.round(averageIntervalMs + delta),
  );
}
