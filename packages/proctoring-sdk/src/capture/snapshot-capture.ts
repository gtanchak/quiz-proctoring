import {
  DEFAULT_SNAPSHOT_CONFIG,
  SNAPSHOT_SCHEMA_VERSION,
  validateSnapshotMetadata,
  type SnapshotCaptureConfig,
  type SnapshotKind,
  type SnapshotMetadata,
} from "@proctoring/shared";
import { createCanvasFrameGrabber } from "./frame-grabber.js";
import { nextSnapshotDelay } from "./scheduler.js";
import type {
  FrameGrabber,
  SnapshotCaptureContext,
} from "./types.js";
import { SnapshotUploadQueue } from "./upload-queue.js";

const CAPTURE_KINDS: readonly SnapshotKind[] = ["webcam", "screen"];

/**
 * Periodic webcam/screen snapshot capture (PRO-15). Grabs stills from the
 * streams established at pre-flight (PRO-14) at *randomized* intervals,
 * compresses them, tags each with the attempt id + an accurate capture
 * timestamp, and hands them to a buffered, retrying upload queue.
 *
 * Idempotent `start`/`stop`, like the detectors. The SDK renders nothing and
 * does not own the streams — the host supplies them via `getStream` and the
 * upload transport via `upload`. Per CLAUDE.md, snapshots are discrete stills,
 * never a continuous webcam video stream.
 */
export class SnapshotCapture {
  readonly name = "snapshot-capture";

  private readonly config: SnapshotCaptureConfig;
  private readonly grabFrame: FrameGrabber;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly win: Window | undefined;
  private readonly queue: SnapshotUploadQueue;

  private running = false;
  private readonly timers = new Map<SnapshotKind, number>();

  constructor(private readonly context: SnapshotCaptureContext) {
    this.config = { ...DEFAULT_SNAPSHOT_CONFIG, ...context.config };
    this.now = context.now ?? (() => new Date());
    this.random = context.random ?? Math.random;
    this.win =
      context.window ?? (typeof window !== "undefined" ? window : undefined);
    this.grabFrame =
      context.grabFrame ??
      createCanvasFrameGrabber({
        document: context.document,
        window: context.window,
      });
    this.queue = new SnapshotUploadQueue({
      upload: context.upload,
      window: this.win,
      maxQueueSize: context.maxQueueSize,
      onDrop: context.onQueueDrop,
    });
  }

  /** Snapshots still buffered for upload. */
  get pending(): number {
    return this.queue.size;
  }

  start(): void {
    if (this.running || !this.config.enabled) return;
    this.running = true;
    this.queue.start();
    for (const kind of this.enabledKinds()) {
      this.scheduleNext(kind);
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    for (const timer of this.timers.values()) {
      this.clearTimer(timer);
    }
    this.timers.clear();
    this.queue.stop();
  }

  private enabledKinds(): SnapshotKind[] {
    return CAPTURE_KINDS.filter((kind) => this.config[kind]);
  }

  private scheduleNext(kind: SnapshotKind): void {
    const delay = nextSnapshotDelay(
      this.config.averageIntervalMs,
      this.config.jitterRatio,
      this.random,
    );
    const schedule = this.win?.setTimeout ?? setTimeout;
    const timer = schedule(() => {
      void this.captureOnce(kind).finally(() => {
        if (this.running) this.scheduleNext(kind);
      });
    }, delay) as unknown as number;
    this.timers.set(kind, timer);
  }

  /** Grabs, tags, and enqueues one snapshot. Best-effort: never throws. */
  private async captureOnce(kind: SnapshotKind): Promise<void> {
    const stream = this.context.getStream(kind);
    if (!stream) return; // signal not granted / stream gone — skip this tick

    // Stamp the capture instant before encoding, so the timestamp reflects when
    // the frame was taken (advisory client time, not the server test timer).
    const capturedAt = this.now();
    const frame = await this.grabFrame(stream, {
      maxDimension: this.config.maxDimension,
      imageQuality: this.config.imageQuality,
      format: this.config.format,
    });
    if (!frame) return;

    const metadata = this.buildMetadata(kind, capturedAt, frame.blob.size, frame);
    this.queue.enqueue({ metadata, blob: frame.blob });
  }

  private buildMetadata(
    kind: SnapshotKind,
    capturedAt: Date,
    byteSize: number,
    frame: { width: number; height: number },
  ): SnapshotMetadata {
    const candidate = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      attemptId: this.context.attemptId,
      kind,
      capturedAt: capturedAt.toISOString(),
      contentType: this.config.format,
      byteSize,
      width: frame.width,
      height: frame.height,
    };
    // Validate against the shared contract before it leaves the browser — the
    // same schema the storage service validates on receipt (cf. createViolationEvent).
    const result = validateSnapshotMetadata(candidate);
    if (!result.valid) {
      throw new Error(`Invalid snapshot metadata: ${result.errors.join("; ")}`);
    }
    return result.value;
  }

  private clearTimer(timer: number): void {
    const cancel = this.win?.clearTimeout ?? clearTimeout;
    cancel(timer);
  }
}
