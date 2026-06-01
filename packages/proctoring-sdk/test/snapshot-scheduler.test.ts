import { describe, expect, it } from "vitest";
import {
  MIN_SNAPSHOT_INTERVAL_MS,
  nextSnapshotDelay,
} from "../src/capture/scheduler.js";

describe("nextSnapshotDelay", () => {
  it("returns the average when jitter is 0 (fixed interval)", () => {
    expect(nextSnapshotDelay(30_000, 0, () => 0)).toBe(30_000);
    expect(nextSnapshotDelay(30_000, 0, () => 1)).toBe(30_000);
  });

  it("returns the average at the midpoint of the random range", () => {
    expect(nextSnapshotDelay(30_000, 0.5, () => 0.5)).toBe(30_000);
  });

  it("spans [avg*(1-jitter), avg*(1+jitter)] across the random range", () => {
    expect(nextSnapshotDelay(30_000, 0.5, () => 0)).toBe(15_000);
    expect(nextSnapshotDelay(30_000, 0.5, () => 1)).toBe(45_000);
  });

  it("never schedules below the floor", () => {
    expect(nextSnapshotDelay(1_000, 1, () => 0)).toBe(MIN_SNAPSHOT_INTERVAL_MS);
  });

  it("produces varied delays (not perfectly predictable)", () => {
    const seq = [0.1, 0.9, 0.3, 0.7];
    let i = 0;
    const delays = seq.map(() => nextSnapshotDelay(30_000, 0.5, () => seq[i++]));
    expect(new Set(delays).size).toBeGreaterThan(1);
  });
});
