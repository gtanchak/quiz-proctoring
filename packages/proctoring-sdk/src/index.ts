/**
 * @proctoring/proctoring-sdk — the embeddable proctoring SDK.
 *
 * Framework-agnostic and self-contained: it runs inside any host page and MUST
 * NOT depend on React (see CLAUDE.md §5). Detection runs client-side; only
 * discrete violation events and periodic snapshots are uploaded — never a
 * continuous webcam stream.
 *
 * Provides the violation event builders (PRO-50), the client-side detectors
 * (PRO-16/17), and the pre-test permission flow & environment check (PRO-14).
 */

export * from "./violations.js";
export * from "./detectors/index.js";
// Pre-test device permission flow & environment check (PRO-14).
export * from "./preflight/index.js";

export const SDK_VERSION = "0.1.0" as const;

/** Placeholder until permission/capture/detector modules are implemented. */
export interface ProctoringSdkOptions {
  /** The attempt this proctoring session is bound to. */
  readonly attemptId: string;
}
