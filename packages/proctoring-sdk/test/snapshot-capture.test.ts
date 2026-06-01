import type { SnapshotCaptureConfig } from "@proctoring/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SnapshotCapture } from "../src/capture/snapshot-capture.js";
import type {
  CapturedFrame,
  Snapshot,
  SnapshotCaptureContext,
  SnapshotKind,
} from "../src/capture/types.js";
import { flush, makeFakeWindow, type FakeWindow } from "./fake-window.js";

const ATTEMPT = "22222222-2222-2222-2222-222222222222";
const FROZEN = new Date("2026-06-01T12:00:00.000Z");

let fake: FakeWindow;

function frame(): CapturedFrame {
  return { blob: new Blob(["img"], { type: "image/jpeg" }), width: 320, height: 240 };
}

function setup(
  config: Partial<SnapshotCaptureConfig>,
  streams: Partial<Record<SnapshotKind, MediaStream | null>> = {},
) {
  const uploaded: Snapshot[] = [];
  const grabFrame = vi.fn().mockResolvedValue(frame());
  const context: SnapshotCaptureContext = {
    attemptId: ATTEMPT,
    getStream: (kind) =>
      kind in streams ? (streams[kind] ?? null) : ({} as MediaStream),
    upload: async (snapshot) => {
      uploaded.push(snapshot);
    },
    config,
    grabFrame,
    now: () => FROZEN,
    random: () => 0.5,
    window: fake.win,
  };
  return { capture: new SnapshotCapture(context), uploaded, grabFrame };
}

beforeEach(() => {
  fake = makeFakeWindow();
});

describe("SnapshotCapture", () => {
  it("captures a webcam snapshot and tags it with attempt id + timestamp", async () => {
    const { capture, uploaded } = setup({ webcam: true, screen: false });
    capture.start();

    expect(fake.pendingTimers()).toBe(1); // one armed kind
    fake.runTimers();
    await flush();

    expect(uploaded).toHaveLength(1);
    expect(uploaded[0].metadata).toMatchObject({
      attemptId: ATTEMPT,
      kind: "webcam",
      capturedAt: FROZEN.toISOString(),
      contentType: "image/jpeg",
      width: 320,
      height: 240,
    });
    expect(uploaded[0].metadata.byteSize).toBe(uploaded[0].blob.size);
    // Re-armed for the next interval.
    expect(fake.pendingTimers()).toBe(1);
    capture.stop();
  });

  it("captures both webcam and screen when both are enabled", async () => {
    const { capture, uploaded } = setup({ webcam: true, screen: true });
    capture.start();
    expect(fake.pendingTimers()).toBe(2);

    fake.runTimers();
    await flush();

    const kinds = uploaded.map((s) => s.metadata.kind).sort();
    expect(kinds).toEqual(["screen", "webcam"]);
    capture.stop();
  });

  it("skips a kind whose stream is unavailable but keeps it scheduled", async () => {
    const { capture, uploaded } = setup(
      { webcam: true, screen: true },
      { screen: null },
    );
    capture.start();
    fake.runTimers();
    await flush();

    expect(uploaded.map((s) => s.metadata.kind)).toEqual(["webcam"]);
    // Screen capture was skipped, not abandoned — it re-arms.
    expect(fake.pendingTimers()).toBe(2);
    capture.stop();
  });

  it("does nothing when capture is disabled", () => {
    const { capture, uploaded } = setup({ enabled: false, webcam: true });
    capture.start();
    expect(fake.pendingTimers()).toBe(0);
    expect(uploaded).toHaveLength(0);
  });

  it("stops cleanly — no captures after stop()", async () => {
    const { capture, grabFrame } = setup({ webcam: true });
    capture.start();
    capture.stop();
    expect(fake.pendingTimers()).toBe(0);

    fake.runTimers();
    await flush();
    expect(grabFrame).not.toHaveBeenCalled();
  });
});
