# @proctoring/proctoring-sdk

The embeddable, **framework-agnostic** proctoring SDK. It runs inside any host
page and **must not depend on React** (see `CLAUDE.md` §5). Detection runs
client-side; only discrete violation events and periodic snapshots are
uploaded — never a continuous webcam stream.

Violation events are built and validated against the shared contract
(`@proctoring/shared`, PRO-50) before they leave the browser, so a client can
never emit a shape the ingestion service will reject.

```ts
import { createViolationEvent, TabSwitchDetector } from "@proctoring/proctoring-sdk";
```

## Detectors

A detector implements `{ start(); stop(); }` and emits validated
`ViolationEvent`s to a sink you provide:

```ts
const detector = new TabSwitchDetector({
  attemptId,
  emit: (event) => queue.push(event), // hand to the upload queue
});
detector.start();
// ... later, when the attempt ends:
detector.stop();
```

`DetectorContext` lets you inject `document`/`window`/`now` (for tests) and an
optional `captureEvidence(type)` hook (PRO-15) to attach screenshot evidence ids.

### TabSwitchDetector (PRO-16)

Detects leaving the test surface and emits a violation **with the away
duration** when the candidate returns:

- **`tab_switch`** — tab hidden/minimised (Page Visibility API).
- **`window_blur`** — window lost focus while the tab stayed visible (app switch).
- **`multiple_monitors`** — best-effort extended-desktop check at start
  (`screen.isExtended`).

Config: `detectTabSwitch`, `detectAppSwitch`, `detectMultipleMonitors` (all
default `true`) and `minAwayMs` (ignore blips shorter than this). The
count-threshold / auto-submit behaviour is **PRO-19**; this detector only emits.

#### Detection limits (browsers restrict this — it is **not** a lockdown browser)

- We can tell the tab/window was hidden or lost focus, **not what the candidate
  switched to.** A screenshot of the off-test state requires the evidence/
  snapshot subsystem (**PRO-15**) and is wired via `captureEvidence`; this
  detector does not capture screens itself.
- **App-switch** detection relies on the OS firing a window `blur`; some setups
  (floating/picture-in-picture windows, certain Linux WMs) may not.
- **Multiple-monitor** detection uses `screen.isExtended`, which is unavailable
  or permission-gated (Window Management API) in many browsers — absence is
  reported as "not detected", never a false negative claim.
- A `blur` that is immediately followed by the tab being hidden is reclassified
  as a `tab_switch` (no double counting).

### FullscreenController (PRO-17)

Enforces running the test in fullscreen and logs `fullscreen_exit` violations.
The SDK renders no UI, so it exposes controls + callbacks and the **host
(candidate-web) owns the prompt/pause UX**:

```ts
const fs = new FullscreenController(
  { attemptId, emit: (e) => queue.push(e) },
  {
    onExit: () => showReturnToFullscreenOverlay(), // host prompt (and pause, if configured)
    onEnter: () => hideOverlay(),
  },
);
fs.start();
startButton.addEventListener("click", () => fs.enter()); // MUST be a user gesture
```

- `enter()` / `exit()` / `isFullscreen()`; emits `fullscreen_exit` (with
  timestamp) when the candidate leaves fullscreen.
- `config.required` (default `true`) — when `false`, the controller stays passive.
- **Limits:** entering/re-entering fullscreen **requires a user gesture** — a
  page cannot silently force it back, so the host must call `enter()` from a
  click. Exit (Esc / F11 / OS gestures) cannot be blocked by the page; the
  enforcement is detect + prompt, not prevention. Exit count thresholds /
  auto-submit are **PRO-19**.

## Snapshot capture (PRO-15)

`SnapshotCapture` periodically grabs **still images** from the webcam and/or
screen streams established at pre-flight (PRO-14), compresses them, and uploads
them through a buffered, retrying queue. Per `CLAUDE.md`, these are discrete
stills — **never** a continuous webcam video stream.

```ts
const capture = new SnapshotCapture({
  attemptId,
  // Resolve the live stream per kind (camera → "webcam").
  getStream: (kind) =>
    kind === "webcam"
      ? preflight.getStreams().camera
      : preflight.getStreams().screen,
  // Transport is the host's job (signed-URL PUT / multipart POST; PRO-27/PRO-38).
  // Throw to mark a transient failure — the snapshot stays buffered and retries.
  upload: async ({ metadata, blob }) => {
    await uploadEvidence(metadata, blob);
  },
  config, // SnapshotCaptureConfig from the test's admin settings (@proctoring/shared)
});
capture.start();
// ... when the attempt ends:
capture.stop();
```

- **Randomized intervals.** Captures fire at delays drawn uniformly from
  `[avg*(1-jitter), avg*(1+jitter)]` around `averageIntervalMs` — fixed
  intervals are easy for a candidate to game, so randomization is deliberate.
- **Admin config** (`SnapshotCaptureConfig`, defined in `@proctoring/shared`):
  `enabled`, `webcam`, `screen` (webcam-only vs. webcam+screen),
  `averageIntervalMs`, `jitterRatio`, `maxDimension`, `imageQuality`, `format`.
- **Each image is tagged** with a validated `SnapshotMetadata` (client-generated
  id, attempt id, kind, accurate `capturedAt`, content type, size, dimensions) —
  the same shared schema the storage service validates on receipt.
- **Network loss does not lose images.** `SnapshotUploadQueue` buffers snapshots
  and retries with exponential backoff, flushing immediately on the browser's
  `online` event. The buffer is bounded (drops oldest under sustained
  back-pressure, reported via `onQueueDrop`) so capture never degrades the test.
- **Storage is out of scope here.** The SDK exposes the `upload` **port**; the
  signed-URL/S3 transport and the evidence viewer are Evidence/Infrastructure
  (PRO-27 / PRO-38). The frame grabber is injectable (`grabFrame`) — the default
  uses `<video>`→canvas (cross-browser; `ImageCapture` is still missing in
  Safari/Firefox) with `OffscreenCanvas` when available.

## Scripts

```bash
pnpm --filter @proctoring/proctoring-sdk build   # tsc -> dist
pnpm --filter @proctoring/proctoring-sdk test    # vitest (jsdom)
```

Tests run in jsdom; real cross-browser behaviour (tab/fullscreen/media quirks)
is verified separately, as flagged in `CLAUDE.md` §8.
