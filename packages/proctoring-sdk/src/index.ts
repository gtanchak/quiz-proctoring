/**
 * @proctoring/proctoring-sdk — the embeddable proctoring SDK.
 *
 * Framework-agnostic and self-contained: it runs inside any host page and MUST
 * NOT depend on React (see CLAUDE.md §5). Detection runs client-side; only
 * discrete violation events and periodic snapshots are uploaded — never a
 * continuous webcam stream.
 *
 * This is the PRO-46 skeleton — no detector logic yet, but violation events are
 * built and validated against the shared schema (PRO-50).
 */

export * from "./violations.js";
export * from "./detectors/index.js";

export const SDK_VERSION = "0.0.0" as const;

/** Placeholder until permission/capture/detector modules are implemented. */
export interface ProctoringSdkOptions {
  /** The attempt this proctoring session is bound to. */
  readonly attemptId: string;
}
