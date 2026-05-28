# @proctoring/proctoring-sdk

The embeddable, **framework-agnostic** proctoring SDK. It runs inside any host
page and **must not depend on React** (see `CLAUDE.md` §5). Detection runs
client-side; only discrete violation events (and, later, periodic snapshots) are
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

## Scripts

```bash
pnpm --filter @proctoring/proctoring-sdk build   # tsc -> dist
pnpm --filter @proctoring/proctoring-sdk test    # vitest (jsdom)
```

Tests run in jsdom; real cross-browser behaviour (tab/fullscreen/media quirks)
is verified separately, as flagged in `CLAUDE.md` §8.
