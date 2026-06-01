import {
  PROCTORING_SIGNALS,
  type ProctoringRequirements,
  type ProctoringSignal,
} from "@proctoring/shared";
import { checkEnvironment } from "./environment.js";
import type {
  EnvironmentReport,
  PermissionStatus,
  PreflightContext,
  PreflightListener,
  PreflightState,
  RecoveryHint,
  SignalState,
} from "./types.js";

/**
 * Drives the pre-test permission flow (PRO-14): requests camera / microphone /
 * screen, tracks each signal's status, and reports when every *required* signal
 * is granted. Framework-agnostic and observable — a host (candidate-web)
 * subscribes and renders; the SDK renders nothing.
 *
 * The acquired streams are the hand-off to later detectors (PRO-15 snapshots,
 * PRO-18 face): read them via `getStreams()` rather than re-acquiring.
 */
export class PreflightController {
  readonly environment: EnvironmentReport;

  private readonly nav: Navigator;
  private readonly listeners = new Set<PreflightListener>();
  private state: PreflightState;

  constructor(
    requirements: ProctoringRequirements,
    context: PreflightContext = {},
  ) {
    this.environment = checkEnvironment(context);
    this.nav =
      context.navigator ??
      (typeof navigator !== "undefined" ? navigator : ({} as Navigator));

    const signals = Object.fromEntries(
      PROCTORING_SIGNALS.map((signal): [ProctoringSignal, SignalState] => [
        signal,
        {
          signal,
          required: requirements[signal],
          status: "idle",
          recovery: null,
          stream: null,
        },
      ]),
    ) as Record<ProctoringSignal, SignalState>;

    this.state = { signals, ready: this.computeReady(signals) };
  }

  /** Current immutable state snapshot. */
  getState(): PreflightState {
    return this.state;
  }

  /** Subscribe to state changes. Fires immediately with the current state. */
  subscribe(listener: PreflightListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** True when every required signal is granted — the gate to start. */
  isReady(): boolean {
    return this.state.ready;
  }

  /** Acquired streams, keyed by signal — the hand-off to later detectors. */
  getStreams(): Record<ProctoringSignal, MediaStream | null> {
    return {
      camera: this.state.signals.camera.stream,
      microphone: this.state.signals.microphone.stream,
      screen: this.state.signals.screen.stream,
    };
  }

  requestCamera(): Promise<void> {
    return this.request("camera");
  }

  requestMicrophone(): Promise<void> {
    return this.request("microphone");
  }

  requestScreen(): Promise<void> {
    return this.request("screen");
  }

  /** Stops every acquired track and resets signals to idle (abandon/cleanup). */
  stop(): void {
    for (const signal of PROCTORING_SIGNALS) {
      this.stopStream(this.state.signals[signal].stream);
    }
    this.state = {
      signals: Object.fromEntries(
        PROCTORING_SIGNALS.map((signal): [ProctoringSignal, SignalState] => [
          signal,
          { ...this.state.signals[signal], status: "idle", recovery: null, stream: null },
        ]),
      ) as Record<ProctoringSignal, SignalState>,
      ready: false,
    };
    this.emit();
  }

  /** Stops streams and drops all subscribers. Call on unmount. */
  dispose(): void {
    this.stop();
    this.listeners.clear();
  }

  private async request(signal: ProctoringSignal): Promise<void> {
    const media = this.nav.mediaDevices as MediaDevices | undefined;
    if (!media) {
      this.setSignal(signal, "unavailable", "connect-device");
      return;
    }

    this.setSignal(signal, "prompting", null);
    try {
      const stream =
        signal === "screen"
          ? await media.getDisplayMedia({ video: true })
          : await media.getUserMedia(
              signal === "camera" ? { video: true } : { audio: true },
            );
      // Replace any previous stream for this signal (e.g. on retry).
      this.stopStream(this.state.signals[signal].stream);
      this.updateSignal(signal, {
        status: "granted",
        recovery: null,
        stream,
        errorName: undefined,
      });
    } catch (err) {
      const { status, recovery, name } = mapMediaError(err);
      this.updateSignal(signal, { status, recovery, stream: null, errorName: name });
    }
  }

  private setSignal(
    signal: ProctoringSignal,
    status: PermissionStatus,
    recovery: RecoveryHint,
  ): void {
    this.updateSignal(signal, { status, recovery });
  }

  private updateSignal(
    signal: ProctoringSignal,
    patch: Partial<SignalState>,
  ): void {
    const signals = {
      ...this.state.signals,
      [signal]: { ...this.state.signals[signal], ...patch },
    };
    this.state = { signals, ready: this.computeReady(signals) };
    this.emit();
  }

  private computeReady(
    signals: Record<ProctoringSignal, SignalState>,
  ): boolean {
    return PROCTORING_SIGNALS.every(
      (s) => !signals[s].required || signals[s].status === "granted",
    );
  }

  private stopStream(stream: MediaStream | null): void {
    stream?.getTracks().forEach((track) => track.stop());
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

/** Maps a media-capture rejection to a status + recovery hint. */
function mapMediaError(err: unknown): {
  status: PermissionStatus;
  recovery: RecoveryHint;
  name: string;
} {
  const name =
    err instanceof DOMException
      ? err.name
      : err instanceof Error
        ? err.name
        : "Error";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return { status: "denied", recovery: "allow-in-browser", name };
    case "NotFoundError":
    case "OverconstrainedError":
      return { status: "unavailable", recovery: "connect-device", name };
    case "NotReadableError":
    case "TrackStartError":
      return { status: "unavailable", recovery: "close-other-apps", name };
    case "AbortError":
      return { status: "dismissed", recovery: "retry", name };
    default:
      return { status: "error", recovery: "retry", name };
  }
}
