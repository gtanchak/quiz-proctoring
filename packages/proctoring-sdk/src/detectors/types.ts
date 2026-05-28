import type { ViolationEvent } from "@proctoring/shared";

/** A sink the SDK passes to detectors; receives each validated violation. */
export type ViolationSink = (event: ViolationEvent) => void;

/**
 * Shared dependencies a detector needs. `document`/`window`/`now` are injectable
 * so detectors can be unit-tested in jsdom with a deterministic clock; in a real
 * host page they default to the globals.
 */
export interface DetectorContext {
  attemptId: string;
  emit: ViolationSink;
  document?: Document;
  window?: Window;
  now?: () => Date;
  /**
   * Optional hook to attach evidence ids (e.g. a screenshot of the off-test
   * state) to a violation. The screenshot capture itself is the evidence/
   * snapshot subsystem (PRO-15); detectors only call this hook when present.
   */
  captureEvidence?: (type: string) => string[];
}

/** A proctoring detector. Idempotent `start`/`stop`; safe to stop if not started. */
export interface Detector {
  readonly name: string;
  start(): void;
  stop(): void;
}
