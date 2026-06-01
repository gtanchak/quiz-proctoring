import { Type, type Static } from "@sinclair/typebox";

/**
 * Which proctoring signals a test requires before a candidate may start (PRO-14).
 *
 * This is the cross-boundary contract: a test's admin config (server) sets it,
 * and the candidate's pre-test gateway (SDK + candidate-web) enforces it. Until
 * per-test persistence lands, callers use DEFAULT_PROCTORING_REQUIREMENTS.
 */
export const PROCTORING_SIGNALS = ["camera", "microphone", "screen"] as const;
export type ProctoringSignal = (typeof PROCTORING_SIGNALS)[number];

export const ProctoringRequirementsSchema = Type.Object(
  {
    /** Camera permission must be granted to start. */
    camera: Type.Boolean(),
    /** Microphone permission must be granted to start. */
    microphone: Type.Boolean(),
    /** Screen-share permission must be granted to start. */
    screen: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type ProctoringRequirements = Static<typeof ProctoringRequirementsSchema>;

/**
 * MVP default: camera + microphone are required; screen-share is optional
 * (continuous screen recording is a V1 feature — the pre-test still offers the
 * screen-share path, but it does not block starting).
 */
export const DEFAULT_PROCTORING_REQUIREMENTS: ProctoringRequirements = {
  camera: true,
  microphone: true,
  screen: false,
};
