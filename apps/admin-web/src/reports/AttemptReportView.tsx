import type { AttemptReport, ReportViolation } from "@proctoring/shared";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@proctoring/ui-components";
import { useState } from "react";
import { ViolationTimeline } from "./ViolationTimeline.js";
import {
  formatClock,
  formatDuration,
  formatOffset,
  formatScore,
  outcomeLabel,
  outcomeVariant,
  severityVariant,
  violationLabel,
} from "./violation-display.js";

/** Reason copy shown beneath the outcome badge for auto-terminated attempts. */
const REASON_COPY: Record<string, string> = {
  deadline_reached: "The test timer expired and the attempt was auto-submitted.",
  abandoned: "The candidate left without submitting.",
};

interface AttemptReportViewProps {
  report: AttemptReport;
}

/**
 * Presentational per-attempt report (PRO-26): a summary header, a visual
 * violation timeline, and an expandable list of every logged violation.
 * Renders purely from the {@link AttemptReport} contract — data fetching lives
 * in {@link AttemptReportPage}.
 */
export function AttemptReportView({
  report,
}: AttemptReportViewProps): JSX.Element {
  const { attempt, test, timeline } = report;
  // Timeline x-axis: prefer the configured duration; fall back to the last event.
  const durationMs = test.durationMinutes
    ? test.durationMinutes * 60_000
    : Math.max(0, ...timeline.map((v) => v.offsetMs));

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-2xl">{test.title}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {attempt.candidateEmail ?? "Anonymous candidate"}
              </p>
            </div>
            <Badge variant={outcomeVariant(attempt.status)}>
              {outcomeLabel(attempt.status)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {attempt.terminationReason ? (
            <p className="mb-4 text-sm text-muted-foreground">
              {REASON_COPY[attempt.terminationReason]}
            </p>
          ) : null}

          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Score" value={formatScore(attempt.score, attempt.maxScore)} />
            <Stat label="Violations" value={String(report.violationCount)} />
            <Stat
              label="Time used"
              value={
                attempt.durationUsedMs === null
                  ? "—"
                  : formatOffset(attempt.durationUsedMs)
              }
            />
            <Stat
              label="Duration"
              value={test.durationMinutes ? `${test.durationMinutes} min` : "Untimed"}
            />
            <Stat label="Started" value={formatClock(attempt.startedAt)} />
            <Stat label="Submitted" value={formatClock(attempt.submittedAt)} />
          </dl>
        </CardContent>
      </Card>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">
          Violation timeline
        </h2>
        <ViolationTimeline violations={timeline} totalMs={durationMs} />
      </section>

      {timeline.length > 0 ? (
        <ul className="mt-6 divide-y rounded-md border">
          {timeline.map((v) => (
            <ViolationRow key={v.id} violation={v} />
          ))}
        </ul>
      ) : null}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  );
}

/** One expandable violation row. Evidence thumbnails arrive with PRO-27 (V1). */
function ViolationRow({
  violation,
}: {
  violation: ReportViolation;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
          {formatOffset(violation.offsetMs)}
        </span>
        <span className="flex-1 text-sm font-medium">
          {violationLabel(violation.type)}
        </span>
        <Badge variant={severityVariant(violation.severity)}>
          {violation.severity}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} details for ${violationLabel(violation.type)}`}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide" : "Details"}
        </Button>
      </div>

      {open ? (
        <dl className="mt-3 grid grid-cols-2 gap-2 pl-14 text-sm sm:grid-cols-3">
          <Detail label="Started" value={formatClock(violation.startedAt)} />
          <Detail label="Ended" value={formatClock(violation.endedAt)} />
          <Detail label="Duration" value={formatDuration(violation.durationMs)} />
          <Detail
            label="Evidence"
            value={
              violation.evidenceIds.length > 0
                ? `${violation.evidenceIds.length} item(s) — viewer arrives in V1`
                : "None"
            }
          />
        </dl>
      ) : null}
    </li>
  );
}

function Detail({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
