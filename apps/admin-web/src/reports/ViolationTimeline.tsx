import type { ReportViolation } from "@proctoring/shared";
import { cn } from "@proctoring/ui-components";
import {
  formatOffset,
  severityMarkerClass,
  violationLabel,
} from "./violation-display.js";

interface ViolationTimelineProps {
  violations: ReportViolation[];
  /** Span of the x-axis in ms — the test duration, or the last event if unknown. */
  totalMs: number;
}

/**
 * A horizontal timeline aligned to the test duration, with one marker per
 * violation positioned by its offset from the attempt start. Clustering is
 * visible at a glance; severity is encoded by colour. Per-event detail lives in
 * the expandable rows below (see {@link AttemptReportView}).
 */
export function ViolationTimeline({
  violations,
  totalMs,
}: ViolationTimelineProps): JSX.Element {
  if (violations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No violations were recorded during this attempt.
      </p>
    );
  }

  const span = Math.max(totalMs, 1);
  return (
    <div>
      <div
        className="relative h-10 rounded-md border bg-muted/40"
        role="img"
        aria-label={`Violation timeline with ${violations.length} event(s)`}
      >
        {violations.map((v) => {
          const pct = Math.min(100, (v.offsetMs / span) * 100);
          return (
            <span
              key={v.id}
              data-testid="timeline-marker"
              className={cn(
                "absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background",
                severityMarkerClass(v.severity),
              )}
              style={{ left: `${pct}%` }}
              title={`${violationLabel(v.type)} @ ${formatOffset(v.offsetMs)}`}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>0:00</span>
        <span>{formatOffset(span)}</span>
      </div>
    </div>
  );
}
