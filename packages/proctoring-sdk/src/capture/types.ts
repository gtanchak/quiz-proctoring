import type {
  SnapshotCaptureConfig,
  SnapshotImageFormat,
  SnapshotKind,
  SnapshotMetadata,
} from "@proctoring/shared";

export type { SnapshotCaptureConfig, SnapshotKind, SnapshotMetadata };

/** A frame grabbed and encoded from a media stream. */
export interface CapturedFrame {
  blob: Blob;
  width: number;
  height: number;
}

/** Encoder inputs for a single grab. */
export interface FrameGrabOptions {
  /** Longest-edge pixel cap; larger frames are downscaled. */
  maxDimension: number;
  /** Encoder quality 0..1. */
  imageQuality: number;
  format: SnapshotImageFormat;
}

/**
 * Grabs and encodes one still from a live {@link MediaStream}. Returns `null`
 * when no usable frame is available (e.g. the track ended) — capture is
 * best-effort and never throws into the scheduler. Injectable so the capture
 * engine is unit-testable without a real canvas/video (jsdom has neither).
 */
export type FrameGrabber = (
  stream: MediaStream,
  options: FrameGrabOptions,
) => Promise<CapturedFrame | null>;

/** An encoded snapshot ready to upload: validated metadata + image bytes. */
export interface Snapshot {
  metadata: SnapshotMetadata;
  blob: Blob;
}

/**
 * Transport for one snapshot. The SDK does NOT know how evidence is stored —
 * the host wires this to the storage service (signed-URL PUT or multipart POST;
 * PRO-27 / PRO-38). **Throw** to signal a transient failure: the snapshot stays
 * buffered and is retried (with backoff, and immediately on reconnect).
 */
export type SnapshotUploader = (snapshot: Snapshot) => Promise<void>;

/**
 * Everything the capture engine needs. Globals (`window`/`document`/`now`/
 * `random`) are injectable for deterministic tests; in a real host page they
 * default to the platform globals. Mirrors `DetectorContext`'s style.
 */
export interface SnapshotCaptureContext {
  attemptId: string;
  /**
   * Resolves the live stream for a kind at capture time — typically backed by
   * `PreflightController.getStreams()` (camera→"webcam"). Returning `null`
   * skips that capture (the kind keeps its schedule).
   */
  getStream: (kind: SnapshotKind) => MediaStream | null;
  /** Transport for encoded snapshots (see {@link SnapshotUploader}). */
  upload: SnapshotUploader;
  /** Admin capture settings; merged over DEFAULT_SNAPSHOT_CONFIG. */
  config?: Partial<SnapshotCaptureConfig>;
  /** Frame grabber; defaults to a canvas/video implementation. */
  grabFrame?: FrameGrabber;
  now?: () => Date;
  random?: () => number;
  window?: Window;
  document?: Document;
  /** Max buffered snapshots before the oldest is dropped under back-pressure. */
  maxQueueSize?: number;
  /** Called when the buffer drops the oldest snapshot (back-pressure signal). */
  onQueueDrop?: (droppedTotal: number) => void;
}
