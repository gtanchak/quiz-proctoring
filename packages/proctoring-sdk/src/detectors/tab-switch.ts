import type { ViolationSeverity, ViolationType } from "@proctoring/shared";
import { createViolationEvent } from "../violations.js";
import type { Detector, DetectorContext } from "./types.js";

export interface TabSwitchConfig {
  /** Detect leaving the test tab (Page Visibility API). Default true. */
  detectTabSwitch?: boolean;
  /** Detect switching to another app (window blur while tab stays visible). Default true. */
  detectAppSwitch?: boolean;
  /** Best-effort check for an extended desktop at start. Default true. */
  detectMultipleMonitors?: boolean;
  /** Ignore away-intervals shorter than this (ms) — filters incidental blips. Default 0. */
  minAwayMs?: number;
}

type AwayKind = Extract<ViolationType, "tab_switch" | "window_blur">;

/** Longer absences are more suspicious; severity stays advisory either way. */
function severityForAway(ms: number): ViolationSeverity {
  if (ms < 3_000) return "low";
  if (ms < 15_000) return "medium";
  return "high";
}

/**
 * Detects when the candidate leaves the test surface — switching browser tabs,
 * switching to another application, or (best-effort) using a second display —
 * and emits a violation with the away duration when they return.
 *
 * Detection limits (browsers deliberately restrict this; this is not a lockdown
 * browser):
 * - We can tell the tab/window was hidden or lost focus, **not** what the
 *   candidate switched to. Capturing a screenshot of the off-test state is the
 *   evidence subsystem's job (PRO-15) via `context.captureEvidence`.
 * - App-switch detection relies on the OS blurring the window; some setups
 *   (e.g. floating windows) may not fire blur.
 * - Multiple-monitor detection uses `screen.isExtended`, which is unavailable
 *   or permission-gated in many browsers; absence is reported as "not detected".
 */
export class TabSwitchDetector implements Detector {
  readonly name = "tab-switch";

  private readonly doc: Document;
  private readonly win: Window;
  private readonly now: () => Date;
  private readonly config: Required<Omit<TabSwitchConfig, "minAwayMs">> & {
    minAwayMs: number;
  };

  private running = false;
  private awaySince: Date | null = null;
  private awayKind: AwayKind | null = null;

  constructor(
    private readonly context: DetectorContext,
    config: TabSwitchConfig = {},
  ) {
    this.doc = context.document ?? document;
    this.win = context.window ?? window;
    this.now = context.now ?? (() => new Date());
    this.config = {
      detectTabSwitch: config.detectTabSwitch ?? true,
      detectAppSwitch: config.detectAppSwitch ?? true,
      detectMultipleMonitors: config.detectMultipleMonitors ?? true,
      minAwayMs: config.minAwayMs ?? 0,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.doc.addEventListener("visibilitychange", this.onVisibilityChange);
    this.win.addEventListener("blur", this.onBlur);
    this.win.addEventListener("focus", this.onFocus);
    if (this.config.detectMultipleMonitors) {
      this.checkMultipleMonitors();
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.doc.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.win.removeEventListener("blur", this.onBlur);
    this.win.removeEventListener("focus", this.onFocus);
    this.awaySince = null;
    this.awayKind = null;
  }

  private enterAway(kind: AwayKind): void {
    if (this.awaySince) return;
    this.awaySince = this.now();
    this.awayKind = kind;
  }

  private leaveAway(): void {
    if (!this.awaySince || !this.awayKind) return;
    const endedAt = this.now();
    const durationMs = endedAt.getTime() - this.awaySince.getTime();
    const startedAt = this.awaySince;
    const kind = this.awayKind;
    this.awaySince = null;
    this.awayKind = null;

    if (durationMs < this.config.minAwayMs) return;
    if (kind === "tab_switch" && !this.config.detectTabSwitch) return;
    if (kind === "window_blur" && !this.config.detectAppSwitch) return;

    this.context.emit(
      createViolationEvent({
        attemptId: this.context.attemptId,
        type: kind,
        severity: severityForAway(durationMs),
        startedAt,
        endedAt,
        evidenceIds: this.context.captureEvidence?.(kind),
        metadata: { durationMs },
      }),
    );
  }

  private readonly onVisibilityChange = (): void => {
    if (this.doc.visibilityState === "hidden") {
      // Definitely a tab/window hide — upgrade an in-flight blur to tab_switch.
      if (this.awaySince) {
        this.awayKind = "tab_switch";
      } else {
        this.enterAway("tab_switch");
      }
    } else if (this.doc.visibilityState === "visible") {
      this.leaveAway();
    }
  };

  private readonly onBlur = (): void => {
    // A blur while the tab is still visible means an app/window switch. If the
    // tab is hidden, visibilitychange owns it (avoids double counting).
    if (this.doc.visibilityState === "visible") {
      this.enterAway("window_blur");
    }
  };

  private readonly onFocus = (): void => {
    if (this.doc.visibilityState === "visible") {
      this.leaveAway();
    }
  };

  private checkMultipleMonitors(): void {
    const screen = this.win.screen as Screen & { isExtended?: boolean };
    if (typeof screen?.isExtended === "boolean" && screen.isExtended) {
      const now = this.now();
      this.context.emit(
        createViolationEvent({
          attemptId: this.context.attemptId,
          type: "multiple_monitors",
          severity: "medium",
          startedAt: now,
          evidenceIds: this.context.captureEvidence?.("multiple_monitors"),
          metadata: { detectedAtStart: true },
        }),
      );
    }
  }
}
