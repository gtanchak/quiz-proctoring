import type { SnapshotMetadata } from "@proctoring/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SnapshotUploadQueue } from "../src/capture/upload-queue.js";
import type { Snapshot } from "../src/capture/types.js";
import { flush, makeFakeWindow, type FakeWindow } from "./fake-window.js";

const ATTEMPT = "22222222-2222-2222-2222-222222222222";

let seq = 0;
function makeSnapshot(): Snapshot {
  const metadata = {
    schemaVersion: 1,
    id: `0000000${seq++}-0000-0000-0000-000000000000`,
    attemptId: ATTEMPT,
    kind: "webcam",
    capturedAt: "2026-06-01T12:00:00.000Z",
    contentType: "image/jpeg",
    byteSize: 3,
    width: 320,
    height: 240,
  } as SnapshotMetadata;
  return { metadata, blob: new Blob(["abc"], { type: "image/jpeg" }) };
}

let fake: FakeWindow;
beforeEach(() => {
  seq = 0;
  fake = makeFakeWindow();
});

describe("SnapshotUploadQueue", () => {
  it("uploads a queued snapshot while online", async () => {
    const upload = vi.fn().mockResolvedValue(undefined);
    const queue = new SnapshotUploadQueue({ upload, window: fake.win });
    queue.start();

    queue.enqueue(makeSnapshot());
    await flush();

    expect(upload).toHaveBeenCalledTimes(1);
    expect(queue.size).toBe(0);
  });

  it("keeps a snapshot buffered after a transient failure, then retries", async () => {
    const upload = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(undefined);
    const queue = new SnapshotUploadQueue({ upload, window: fake.win });
    queue.start();

    queue.enqueue(makeSnapshot());
    await flush();
    // First attempt failed: still buffered, a retry timer is pending.
    expect(upload).toHaveBeenCalledTimes(1);
    expect(queue.size).toBe(1);
    expect(fake.pendingTimers()).toBe(1);

    fake.runTimers(); // fire the backoff retry
    await flush();

    expect(upload).toHaveBeenCalledTimes(2);
    expect(queue.size).toBe(0);
  });

  it("does not lose snapshots while offline — flushes on reconnect", async () => {
    const upload = vi.fn().mockResolvedValue(undefined);
    const queue = new SnapshotUploadQueue({ upload, window: fake.win });
    queue.start();

    fake.setOnline(false);
    queue.enqueue(makeSnapshot());
    queue.enqueue(makeSnapshot());
    await flush();

    expect(upload).not.toHaveBeenCalled();
    expect(queue.size).toBe(2);

    fake.setOnline(true);
    fake.fire("online");
    await flush();

    expect(upload).toHaveBeenCalledTimes(2);
    expect(queue.size).toBe(0);
  });

  it("drops the oldest snapshot under back-pressure and reports it", () => {
    const upload = vi.fn().mockResolvedValue(undefined);
    const onDrop = vi.fn();
    // Not started → nothing uploads, so we observe buffering/eviction directly.
    const queue = new SnapshotUploadQueue({
      upload,
      window: fake.win,
      maxQueueSize: 2,
      onDrop,
    });

    queue.enqueue(makeSnapshot());
    queue.enqueue(makeSnapshot());
    queue.enqueue(makeSnapshot());

    expect(queue.size).toBe(2);
    expect(queue.dropped).toBe(1);
    expect(onDrop).toHaveBeenCalledWith(1);
  });
});
