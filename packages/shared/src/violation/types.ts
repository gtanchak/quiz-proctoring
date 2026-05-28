import { Type, type Static } from "@sinclair/typebox";

/**
 * The violation event schema — the single most depended-on contract in the
 * system. Detectors (in the SDK) emit these; the ingestion service validates
 * and stores them; reporting and the Trust Score read them. Defined once here
 * so client and server can never drift.
 *
 * Detection produces **indicators, not verdicts** (see CLAUDE.md): `severity`
 * is advisory and the raw events are always preserved for human review.
 */

/** Current schema version. Bump when the event shape changes (see README). */
export const VIOLATION_SCHEMA_VERSION = 1 as const;

/**
 * Registry of known violation types. Add to this list (and bump the schema
 * version) to introduce a new type — existing stored events keep validating
 * because their types remain in the union. Each maps to a detector
 * (PRO-16…PRO-24).
 */
export const VIOLATION_TYPES = [
  "tab_switch", // left the test tab / window (PRO-16)
  "window_blur", // app lost focus (PRO-16)
  "multiple_monitors", // extra display detected (PRO-16)
  "fullscreen_exit", // left fullscreen (PRO-17)
  "no_face", // no face visible (PRO-18)
  "multiple_faces", // more than one face (PRO-18)
  "looking_away", // gaze off-screen (PRO-18)
  "audio_detected", // speech/noise detected (audio)
  "copy_paste", // clipboard activity (PRO-20)
  "external_help", // external assistance signal (PRO-20)
  "id_mismatch", // ID-to-face mismatch (PRO-22)
  "impersonation", // face changed mid-test (PRO-23)
] as const;

export type ViolationType = (typeof VIOLATION_TYPES)[number];

/** Advisory severity. Never a pass/fail verdict on its own. */
export const VIOLATION_SEVERITIES = ["info", "low", "medium", "high"] as const;
export type ViolationSeverity = (typeof VIOLATION_SEVERITIES)[number];

const ViolationTypeSchema = Type.Union(
  VIOLATION_TYPES.map((t) => Type.Literal(t)),
  { description: "Known violation type (see VIOLATION_TYPES)" },
);

const ViolationSeveritySchema = Type.Union(
  VIOLATION_SEVERITIES.map((s) => Type.Literal(s)),
);

/**
 * A single violation observation from the candidate's browser.
 *
 * Note on time: `startedAt`/`endedAt` are the client's *observed* times (the
 * detector saw it then) and are advisory evidence — they are NOT the
 * server-authoritative test timer. The ingestion service stamps its own
 * authoritative receipt time on arrival (out of scope here).
 */
export const ViolationEventSchema = Type.Object(
  {
    schemaVersion: Type.Integer({
      minimum: 1,
      default: VIOLATION_SCHEMA_VERSION,
      description: "Schema version this event was produced against",
    }),
    /** Client-generated event id — enables idempotent retries / dedup. */
    id: Type.String({ format: "uuid" }),
    attemptId: Type.String({ format: "uuid" }),
    type: ViolationTypeSchema,
    severity: ViolationSeveritySchema,
    /** Client-observed start (ISO 8601). */
    startedAt: Type.String({ format: "date-time" }),
    /** Client-observed end for ranged violations; null/absent if instantaneous. */
    endedAt: Type.Optional(
      Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    ),
    /** Optional duration in ms for ranged violations. */
    durationMs: Type.Optional(
      Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    ),
    /** Ids of evidence (snapshots/clips) captured for this event. */
    evidenceIds: Type.Optional(Type.Array(Type.String(), { default: [] })),
    /** Type-specific extra data (e.g. face counts, hidden duration). */
    metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { $id: "ViolationEvent", additionalProperties: false },
);

export type ViolationEvent = Static<typeof ViolationEventSchema>;

/**
 * A batch of events for one attempt. The SDK buffers events and flushes them in
 * batches (with retry), so the ingestion endpoint accepts many at once.
 */
export const ViolationEventBatchSchema = Type.Object(
  {
    attemptId: Type.String({ format: "uuid" }),
    events: Type.Array(ViolationEventSchema, { minItems: 1, maxItems: 1000 }),
  },
  { $id: "ViolationEventBatch", additionalProperties: false },
);

export type ViolationEventBatch = Static<typeof ViolationEventBatchSchema>;
