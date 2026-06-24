import { Type, type Static } from "@sinclair/typebox";

/**
 * Candidate session lifecycle (PRO-59, FR-19). The runtime state machine every
 * assessment type runs through, defined once here so the engine, both web apps,
 * and future assessment types (MCQ, AI agent) share one definition.
 *
 * Phases are orthogonal to an attempt's terminal `status`
 * (in_progress/submitted/expired/abandoned): `phase` tracks where a *live*
 * candidate is in the flow, advancing forward only; reaching `complete`
 * coincides with finalisation (submit/expiry).
 *
 *   intro → items → wrap_up → complete
 */
export const SESSION_PHASES = [
  "intro",
  "items",
  "wrap_up",
  "complete",
] as const;
export type SessionPhase = (typeof SESSION_PHASES)[number];

export const SessionPhaseSchema = Type.Union(
  SESSION_PHASES.map((p) => Type.Literal(p)),
  { description: "Candidate session phase (see SESSION_PHASES)" },
);

/**
 * Allowed forward transitions. `wrap_up → complete` is driven by finalisation
 * (submit/expiry), not a free candidate move, but is listed so the machine is
 * the single source of truth for validity.
 */
const TRANSITIONS: Record<SessionPhase, readonly SessionPhase[]> = {
  intro: ["items"],
  items: ["wrap_up"],
  wrap_up: ["complete"],
  complete: [],
};

/** Whether `from → to` is a valid session transition. */
export function canAdvanceSession(from: SessionPhase, to: SessionPhase): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Per-turn session event log (PRO-59, FR-23). A timestamped, ordered record of
 * what happened during an attempt — the transcript the AI agent (P2) appends
 * its turns to. `type` is an open set; these are the engine-level types today.
 */
export const SESSION_EVENT_TYPES = [
  "session_started",
  "phase_changed",
  "answers_saved",
  "snapshot_captured",
  "session_completed",
] as const;
export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];

export const SessionEventSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    attemptId: Type.String({ format: "uuid" }),
    /** A known SESSION_EVENT_TYPE, or a future assessment-type-specific value. */
    type: Type.String(),
    phase: Type.Union([SessionPhaseSchema, Type.Null()]),
    /** Event-specific payload; never secrets/PII (CLAUDE.md §6). */
    data: Type.Record(Type.String(), Type.Unknown()),
    at: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);
export type SessionEvent = Static<typeof SessionEventSchema>;

/** Visible progress for a candidate (FR-16): items answered of total + phase. */
export const SessionProgressSchema = Type.Object(
  {
    phase: SessionPhaseSchema,
    answered: Type.Integer({ minimum: 0 }),
    total: Type.Integer({ minimum: 0 }),
    /** Server-computed remaining time in ms, or null when the attempt is untimed. */
    remainingMs: Type.Union([Type.Integer(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type SessionProgress = Static<typeof SessionProgressSchema>;
