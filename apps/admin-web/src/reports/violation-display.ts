import type { AttemptReportSummary } from "@proctoring/shared";
import type { BadgeProps } from "@proctoring/ui-components";

/** Human labels for known violation types; unknown types are humanized. */
const VIOLATION_TYPE_LABELS: Record<string, string> = {
  tab_switch: "Tab switch",
  window_blur: "App switch",
  multiple_monitors: "Multiple monitors",
  fullscreen_exit: "Left fullscreen",
  no_face: "No face visible",
  multiple_faces: "Multiple faces",
  looking_away: "Looking away",
  audio_detected: "Audio detected",
  copy_paste: "Copy / paste",
  external_help: "External help",
  id_mismatch: "ID mismatch",
  impersonation: "Impersonation",
};

function humanize(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function violationLabel(type: string): string {
  return VIOLATION_TYPE_LABELS[type] ?? humanize(type);
}

const SEVERITY_VARIANT: Record<string, BadgeProps["variant"]> = {
  info: "secondary",
  low: "secondary",
  medium: "default",
  high: "destructive",
};

export function severityVariant(severity: string): BadgeProps["variant"] {
  return SEVERITY_VARIANT[severity] ?? "secondary";
}

/** Severity → a tailwind background for the timeline marker. */
const SEVERITY_MARKER: Record<string, string> = {
  info: "bg-muted-foreground",
  low: "bg-amber-400",
  medium: "bg-orange-500",
  high: "bg-destructive",
};

export function severityMarkerClass(severity: string): string {
  return SEVERITY_MARKER[severity] ?? "bg-muted-foreground";
}

/**
 * Plain-language outcome for the attempt status. The termination *reason* (for
 * auto-terminated attempts) is shown separately by the view.
 */
export function outcomeLabel(status: AttemptReportSummary["status"]): string {
  switch (status) {
    case "submitted":
      return "Completed";
    case "expired":
      return "Auto-submitted — time expired";
    case "abandoned":
      return "Abandoned";
    case "in_progress":
      return "In progress";
    default:
      return humanize(status);
  }
}

export function outcomeVariant(
  status: AttemptReportSummary["status"],
): BadgeProps["variant"] {
  if (status === "submitted") return "default";
  if (status === "expired" || status === "abandoned") return "destructive";
  return "secondary";
}

/** `mm:ss` (or `h:mm:ss`) offset from the start of the attempt. */
export function formatOffset(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Human duration for a ranged violation, or `—` when instantaneous/unknown. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return `${mins}m ${rem}s`;
}

/** Locale date-time for a header timestamp, or `—`. */
export function formatClock(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function formatScore(
  score: number | null,
  maxScore: number | null,
): string {
  if (score === null) return "Not graded";
  return maxScore === null ? `${score}` : `${score} / ${maxScore}`;
}
