import type { ProctoringSignal } from "@proctoring/shared";

export type { ProctoringSignal };

/**
 * Lifecycle of a single permission request. Driven by the actual result of
 * `getUserMedia`/`getDisplayMedia` (not the Permissions API, whose support is
 * uneven across browsers — see CLAUDE.md §8).
 */
export type PermissionStatus =
  | "idle" // not requested yet
  | "prompting" // request in flight, awaiting the user
  | "granted"
  | "denied" // user blocked it (re-enable in browser settings)
  | "unavailable" // no device, or device busy / unreadable
  | "dismissed" // user closed the prompt without choosing
  | "error"; // unexpected failure

/** A hint the UI maps to actionable recovery copy. */
export type RecoveryHint =
  | "allow-in-browser"
  | "connect-device"
  | "close-other-apps"
  | "retry"
  | null;

export interface SignalState {
  signal: ProctoringSignal;
  /** Whether this signal must be granted before the candidate can start. */
  required: boolean;
  status: PermissionStatus;
  recovery: RecoveryHint;
  /** The acquired stream when granted; null otherwise. */
  stream: MediaStream | null;
  /** Last underlying error name (e.g. DOMException name) for diagnostics. */
  errorName?: string;
}

export interface EnvironmentReport {
  /** HTTPS / localhost — media capture requires a secure context. */
  secureContext: boolean;
  getUserMedia: boolean;
  getDisplayMedia: boolean;
  fullscreen: boolean;
  /** Best-effort browser name/version parsed from the UA string. */
  browser: string;
  version: string;
  /** Minimum viable environment: secure context + getUserMedia available. */
  isSupported: boolean;
}

export interface PreflightState {
  signals: Record<ProctoringSignal, SignalState>;
  /** True when every *required* signal is granted. */
  ready: boolean;
}

/**
 * Injectable globals so the controller is unit-testable in jsdom (mock
 * `navigator.mediaDevices`). In a real host page these default to the globals.
 */
export interface PreflightContext {
  navigator?: Navigator;
  window?: Window;
}

export type PreflightListener = (state: PreflightState) => void;
