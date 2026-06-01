import { Type, type Static } from "@sinclair/typebox";

/**
 * Evidence capture contract (PRO-15): periodic webcam/screen snapshots.
 *
 * Two cross-boundary shapes live here, defined once so admin-web, the SDK, and
 * the (future) evidence storage service can never drift (see CLAUDE.md §4):
 *
 *  - {@link SnapshotCaptureConfig} — the admin's capture settings (server sets
 *    it per test; the candidate's SDK enforces it).
 *  - {@link SnapshotMetadata} — the per-image metadata uploaded alongside each
 *    snapshot (attempt id + accurate capture timestamp + kind).
 *
 * The image *bytes* and where they are stored (signed-URL S3 uploads) are NOT
 * defined here — storage is Evidence/Infrastructure (PRO-27 / PRO-38). This
 * package only owns the data contract.
 */

/** Bump when {@link SnapshotMetadata} changes shape (same discipline as the violation schema). */
export const SNAPSHOT_SCHEMA_VERSION = 1 as const;

/** What a snapshot is of. "webcam" pairs with the camera signal; "screen" with screen-share. */
export const SNAPSHOT_KINDS = ["webcam", "screen"] as const;
export type SnapshotKind = (typeof SNAPSHOT_KINDS)[number];

/** Encoded image formats we compress to. JPEG is the safe cross-browser default; WebP is smaller where supported. */
export const SNAPSHOT_IMAGE_FORMATS = ["image/jpeg", "image/webp"] as const;
export type SnapshotImageFormat = (typeof SNAPSHOT_IMAGE_FORMATS)[number];

const SnapshotKindSchema = Type.Union(
  SNAPSHOT_KINDS.map((k) => Type.Literal(k)),
);
const SnapshotImageFormatSchema = Type.Union(
  SNAPSHOT_IMAGE_FORMATS.map((f) => Type.Literal(f)),
);

/**
 * Admin-configured capture settings for a test. Snapshots fire at *randomized*
 * intervals around `averageIntervalMs` (fixed intervals are easy for a candidate
 * to game — see the issue note), spread by `jitterRatio`.
 */
export const SnapshotCaptureConfigSchema = Type.Object(
  {
    /** Master switch; when false the SDK captures nothing. */
    enabled: Type.Boolean({ default: true }),
    /** Capture webcam stills. */
    webcam: Type.Boolean({ default: true }),
    /** Capture screen stills (webcam-only vs. webcam+screen). */
    screen: Type.Boolean({ default: false }),
    /** Average time between snapshots of a given kind, in ms. */
    averageIntervalMs: Type.Integer({ minimum: 1_000, default: 30_000 }),
    /**
     * Randomization spread as a fraction of the average: actual delays fall in
     * `[avg*(1-jitter), avg*(1+jitter)]`. 0 = fixed (predictable, discouraged).
     */
    jitterRatio: Type.Number({ minimum: 0, maximum: 1, default: 0.5 }),
    /** Longest-edge pixel cap; larger frames are downscaled before encoding. */
    maxDimension: Type.Integer({ minimum: 160, default: 1280 }),
    /** Encoder quality 0..1 (size/quality balance). */
    imageQuality: Type.Number({ minimum: 0.1, maximum: 1, default: 0.7 }),
    /** Encoded image format. */
    format: SnapshotImageFormatSchema,
  },
  { $id: "SnapshotCaptureConfig", additionalProperties: false },
);

export type SnapshotCaptureConfig = Static<typeof SnapshotCaptureConfigSchema>;

/**
 * MVP default: webcam snapshots every ~30s (±50%), screen off, modest JPEG.
 * Screen capture is opt-in (continuous screen recording is a V1 feature).
 */
export const DEFAULT_SNAPSHOT_CONFIG: SnapshotCaptureConfig = {
  enabled: true,
  webcam: true,
  screen: false,
  averageIntervalMs: 30_000,
  jitterRatio: 0.5,
  maxDimension: 1280,
  imageQuality: 0.7,
  format: "image/jpeg",
};

/**
 * Metadata uploaded with each snapshot image. The bytes travel separately (a
 * multipart body or a signed-URL PUT); this is the JSON the storage service
 * indexes by. `capturedAt` is the client's *observed* capture time — advisory
 * evidence, like violation timestamps, not the server-authoritative test timer.
 */
export const SnapshotMetadataSchema = Type.Object(
  {
    schemaVersion: Type.Integer({
      minimum: 1,
      default: SNAPSHOT_SCHEMA_VERSION,
      description: "Schema version this metadata was produced against",
    }),
    /** Client-generated id — enables idempotent retries / dedup on the server. */
    id: Type.String({ format: "uuid" }),
    attemptId: Type.String({ format: "uuid" }),
    kind: SnapshotKindSchema,
    /** Client-observed capture time (ISO 8601). */
    capturedAt: Type.String({ format: "date-time" }),
    contentType: SnapshotImageFormatSchema,
    /** Encoded byte size (after compression). */
    byteSize: Type.Integer({ minimum: 0 }),
    /** Pixel dimensions of the (possibly downscaled) encoded image. */
    width: Type.Integer({ minimum: 1 }),
    height: Type.Integer({ minimum: 1 }),
  },
  { $id: "SnapshotMetadata", additionalProperties: false },
);

export type SnapshotMetadata = Static<typeof SnapshotMetadataSchema>;
