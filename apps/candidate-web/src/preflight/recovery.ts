import type { ProctoringSignal, RecoveryHint } from "@proctoring/proctoring-sdk";

function label(signal: ProctoringSignal): string {
  if (signal === "camera") return "camera";
  if (signal === "microphone") return "microphone";
  return "screen share";
}

/** Actionable recovery copy for a denied/unavailable signal. */
export function recoveryText(
  hint: RecoveryHint,
  signal: ProctoringSignal,
): string | null {
  switch (hint) {
    case "allow-in-browser":
      return `Access was blocked. Use the camera/lock icon in your browser's address bar to allow ${label(signal)}, then retry.`;
    case "connect-device":
      return `No ${label(signal)} was found. Connect a device and retry.`;
    case "close-other-apps":
      return `Your ${label(signal)} is in use by another app — close it (e.g. Zoom or Teams) and retry.`;
    case "retry":
      return "The request was dismissed. Click retry and choose “Allow”.";
    default:
      return null;
  }
}
