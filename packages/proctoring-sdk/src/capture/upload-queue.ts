import type { Snapshot, SnapshotUploader } from "./types.js";

export interface SnapshotUploadQueueOptions {
  upload: SnapshotUploader;
  window?: Window;
  /** Max buffered snapshots before the oldest is dropped. Default 200. */
  maxQueueSize?: number;
  /** First retry delay; doubles each consecutive failure. Default 2_000ms. */
  baseBackoffMs?: number;
  /** Backoff ceiling. Default 60_000ms. */
  maxBackoffMs?: number;
  /** Called with the running total each time the oldest snapshot is dropped. */
  onDrop?: (droppedTotal: number) => void;
}

/**
 * Buffers encoded snapshots and uploads them one at a time, surviving network
 * loss: when offline (or an upload throws) the snapshot stays queued and is
 * retried with exponential backoff — and *immediately* when the browser fires
 * `online`. This is the "network interruptions do not lose images" guarantee.
 *
 * The buffer is in-memory and bounded: under sustained back-pressure the oldest
 * snapshot is dropped (and reported via `onDrop`) rather than growing without
 * limit — capture overhead must not degrade the test. Durable cross-reload
 * persistence (IndexedDB) is a future enhancement; the test page stays open for
 * the duration of an attempt.
 */
export class SnapshotUploadQueue {
  private readonly upload: SnapshotUploader;
  private readonly win: Window | undefined;
  private readonly maxQueueSize: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly onDrop?: (droppedTotal: number) => void;

  private readonly queue: Snapshot[] = [];
  private running = false;
  private processing = false;
  private failures = 0;
  private droppedTotal = 0;
  private retryTimer: number | null = null;

  constructor(options: SnapshotUploadQueueOptions) {
    this.upload = options.upload;
    this.win =
      options.window ?? (typeof window !== "undefined" ? window : undefined);
    this.maxQueueSize = options.maxQueueSize ?? 200;
    this.baseBackoffMs = options.baseBackoffMs ?? 2_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 60_000;
    this.onDrop = options.onDrop;
  }

  /** Number of snapshots currently buffered. */
  get size(): number {
    return this.queue.length;
  }

  /** Total snapshots dropped due to back-pressure since construction. */
  get dropped(): number {
    return this.droppedTotal;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.win?.addEventListener("online", this.onOnline);
    this.kick();
  }

  /** Halts processing. Buffered snapshots are retained (a later start resumes). */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.win?.removeEventListener("online", this.onOnline);
    this.clearRetry();
  }

  enqueue(snapshot: Snapshot): void {
    this.queue.push(snapshot);
    while (this.queue.length > this.maxQueueSize) {
      this.queue.shift();
      this.droppedTotal++;
      this.onDrop?.(this.droppedTotal);
    }
    this.kick();
  }

  private readonly onOnline = (): void => {
    // Reconnected — drop the backoff and flush immediately.
    this.failures = 0;
    this.clearRetry();
    this.kick();
  };

  private isOnline(): boolean {
    const nav = this.win?.navigator;
    return nav ? nav.onLine !== false : true;
  }

  private kick(): void {
    if (!this.running || this.processing || this.queue.length === 0) return;
    // Don't burn a request while known-offline; wait for the `online` event.
    if (!this.isOnline()) return;
    this.processing = true;
    void this.processHead();
  }

  private async processHead(): Promise<void> {
    const snapshot = this.queue[0];
    if (!snapshot) {
      this.processing = false;
      return;
    }
    try {
      await this.upload(snapshot);
      this.queue.shift(); // success — remove it
      this.failures = 0;
      this.processing = false;
      this.kick(); // next one, if any
    } catch {
      // Transient failure — keep it buffered and back off.
      this.processing = false;
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    if (!this.running || this.retryTimer !== null) return;
    this.failures++;
    const delay = Math.min(
      this.maxBackoffMs,
      this.baseBackoffMs * 2 ** (this.failures - 1),
    );
    const schedule = this.win?.setTimeout ?? setTimeout;
    this.retryTimer = schedule(() => {
      this.retryTimer = null;
      this.kick();
    }, delay) as unknown as number;
  }

  private clearRetry(): void {
    if (this.retryTimer === null) return;
    const cancel = this.win?.clearTimeout ?? clearTimeout;
    cancel(this.retryTimer);
    this.retryTimer = null;
  }
}
