import { createViolationEvent } from "../violations.js";
import type { Detector, DetectorContext } from "./types.js";

export interface FullscreenConfig {
  /** Whether fullscreen is enforced. When false, exits are not logged. Default true. */
  required?: boolean;
  /** The element to make fullscreen. Default the document element (whole page). */
  target?: () => Element;
  /** Called when fullscreen is exited — the host shows a "return to fullscreen" prompt (and may pause). */
  onExit?: () => void;
  /** Called when fullscreen is (re-)entered — the host hides the prompt / resumes. */
  onEnter?: () => void;
}

/**
 * Enforces running the test in fullscreen and logs exits as violations.
 *
 * The SDK is framework-agnostic and renders no UI: it exposes `enter()` /
 * `exit()` / `isFullscreen()` plus `onExit`/`onEnter` callbacks, and emits a
 * `fullscreen_exit` violation when the candidate leaves fullscreen. The host app
 * (candidate-web) renders the prompt/overlay and decides whether to pause —
 * because:
 * - Entering or re-entering fullscreen **requires a user gesture**; a page
 *   cannot silently force it back. The host must call `enter()` from a click
 *   (e.g. the "Start" button, or a "Return to fullscreen" button).
 * - Exit can be triggered by Esc / F11 / OS gestures, which the page cannot block.
 */
export class FullscreenController implements Detector {
  readonly name = "fullscreen";

  private readonly doc: Document;
  private readonly now: () => Date;
  private readonly required: boolean;
  private readonly target: () => Element;
  private running = false;

  constructor(
    private readonly context: DetectorContext,
    private readonly config: FullscreenConfig = {},
  ) {
    this.doc = context.document ?? document;
    this.now = context.now ?? (() => new Date());
    this.required = config.required ?? true;
    this.target = config.target ?? (() => this.doc.documentElement);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.doc.addEventListener("fullscreenchange", this.onChange);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.doc.removeEventListener("fullscreenchange", this.onChange);
  }

  isFullscreen(): boolean {
    return this.doc.fullscreenElement != null;
  }

  /** Request fullscreen. MUST be called from a user gesture (e.g. a click). */
  async enter(): Promise<void> {
    if (this.isFullscreen()) return;
    await this.target().requestFullscreen();
  }

  async exit(): Promise<void> {
    if (this.isFullscreen()) {
      await this.doc.exitFullscreen();
    }
  }

  private readonly onChange = (): void => {
    // When fullscreen isn't enforced, the controller stays passive.
    if (!this.required) return;
    if (this.isFullscreen()) {
      this.config.onEnter?.();
      return;
    }
    // Left fullscreen.
    this.config.onExit?.();
    const now = this.now();
    this.context.emit(
      createViolationEvent({
        attemptId: this.context.attemptId,
        type: "fullscreen_exit",
        severity: "high",
        startedAt: now,
        evidenceIds: this.context.captureEvidence?.("fullscreen_exit"),
      }),
    );
  };
}
