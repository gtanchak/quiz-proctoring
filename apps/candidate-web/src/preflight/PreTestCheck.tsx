import {
  type EnvironmentReport,
  type PermissionStatus,
  PreflightController,
  type ProctoringSignal,
  type SignalState,
} from "@proctoring/proctoring-sdk";
import {
  PROCTORING_SIGNALS,
  type ProctoringRequirements,
} from "@proctoring/shared";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  type BadgeProps,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Progress,
} from "@proctoring/ui-components";
import { AlertTriangle, Camera, Mic, MonitorUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { recoveryText } from "./recovery.js";
import { usePreflight } from "./usePreflight.js";

const SIGNAL_LABEL: Record<ProctoringSignal, string> = {
  camera: "Camera",
  microphone: "Microphone",
  screen: "Screen share",
};

const SIGNAL_ICON: Record<ProctoringSignal, typeof Camera> = {
  camera: Camera,
  microphone: Mic,
  screen: MonitorUp,
};

const STATUS_LABEL: Record<PermissionStatus, string> = {
  idle: "Not started",
  prompting: "Waiting…",
  granted: "Ready",
  denied: "Blocked",
  unavailable: "Unavailable",
  dismissed: "Dismissed",
  error: "Error",
};

const STATUS_VARIANT: Record<PermissionStatus, BadgeProps["variant"]> = {
  idle: "secondary",
  prompting: "secondary",
  granted: "default",
  denied: "destructive",
  unavailable: "destructive",
  dismissed: "secondary",
  error: "destructive",
};

export interface PreTestCheckProps {
  requirements: ProctoringRequirements;
  onReady: () => void;
  /** Inject a controller (tests); otherwise one is created from requirements. */
  controller?: PreflightController;
}

export function PreTestCheck({
  requirements,
  onReady,
  controller: injected,
}: PreTestCheckProps): JSX.Element {
  const controller = useMemo(
    () => injected ?? new PreflightController(requirements),
    [injected, requirements],
  );
  const { state, environment, ready, request } = usePreflight(controller);

  if (!environment.isSupported) {
    return <UnsupportedScreen environment={environment} />;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Before you start</h1>
      <p className="mt-2 text-muted-foreground">
        This test is proctored. Grant the permissions below so we can verify your
        environment. Nothing is recorded until the test begins, and video never
        leaves your device.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        {PROCTORING_SIGNALS.map((signal) => (
          <SignalCard
            key={signal}
            signal={signal}
            state={state.signals[signal]}
            onRequest={() => request(signal)}
          />
        ))}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <Button disabled={!ready} onClick={onReady}>
          Start test
        </Button>
        {!ready && (
          <span className="text-sm text-muted-foreground">
            Grant all required permissions to continue.
          </span>
        )}
      </div>
    </main>
  );
}

function SignalCard({
  signal,
  state,
  onRequest,
}: {
  signal: ProctoringSignal;
  state: SignalState;
  onRequest: () => void;
}): JSX.Element {
  const Icon = SIGNAL_ICON[signal];
  const recovery = recoveryText(state.recovery, signal);
  const actionLabel =
    state.status === "idle" || state.status === "prompting" ? "Grant" : "Retry";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Icon className="text-muted-foreground" aria-hidden />
          <CardTitle className="flex-1 text-base">
            {SIGNAL_LABEL[signal]}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              {state.required ? "(required)" : "(optional)"}
            </span>
          </CardTitle>
          <Badge variant={STATUS_VARIANT[state.status]}>
            {STATUS_LABEL[state.status]}
          </Badge>
          {state.status !== "granted" && (
            <Button
              size="sm"
              variant="outline"
              onClick={onRequest}
              disabled={state.status === "prompting"}
            >
              {actionLabel}
            </Button>
          )}
        </div>
      </CardHeader>

      {(signal === "camera" || signal === "microphone" || recovery) && (
        <CardContent className="flex flex-col gap-3">
          {signal === "camera" && <CameraPreview stream={state.stream} />}
          {signal === "microphone" && <AudioMeter stream={state.stream} />}
          {recovery && (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden />
              <AlertTitle>Action needed</AlertTitle>
              <AlertDescription>{recovery}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function CameraPreview({
  stream,
}: {
  stream: MediaStream | null;
}): JSX.Element | null {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
    }
  }, [stream]);
  if (!stream) return null;
  return (
    <video
      ref={ref}
      className="w-full max-w-xs -scale-x-100 rounded-md bg-black"
      autoPlay
      muted
      playsInline
      aria-label="Camera preview"
    />
  );
}

function AudioMeter({
  stream,
}: {
  stream: MediaStream | null;
}): JSX.Element | null {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!stream) return;
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    const audioCtx = new AudioCtx();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;

    const tick = (): void => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const sample of data) {
        peak = Math.max(peak, Math.abs(sample - 128));
      }
      setLevel(Math.min(100, Math.round((peak / 128) * 100)));
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void audioCtx.close();
    };
  }, [stream]);

  if (!stream) return null;
  return <Progress value={level} aria-label="Microphone level" />;
}

function UnsupportedScreen({
  environment,
}: {
  environment: EnvironmentReport;
}): JSX.Element {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Alert variant="destructive">
        <AlertTriangle aria-hidden />
        <AlertTitle>Your browser isn't supported</AlertTitle>
        <AlertDescription>
          Proctored tests need a recent desktop browser (Chrome, Edge, Firefox,
          or Safari) on a secure (HTTPS) connection with camera access.{" "}
          {!environment.secureContext
            ? "This page isn't on a secure (HTTPS) connection."
            : "Camera/microphone capture isn't available in this browser."}{" "}
          Detected: {environment.browser}
          {environment.version ? ` ${environment.version}` : ""}.
        </AlertDescription>
      </Alert>
    </main>
  );
}
