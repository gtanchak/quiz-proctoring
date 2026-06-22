import type {
  AttemptReport,
  EvidenceItem,
  ReportViolation,
} from "@proctoring/shared";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@proctoring/ui-components";
import { useState } from "react";
import {
  EvidenceGallery,
  EvidenceLightbox,
  EvidenceThumbnail,
} from "./Evidence.js";
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
  /** Captured evidence (PRO-27), each carrying a signed retrieval URL. */
  evidence?: EvidenceItem[];
  /** When provided, enables the per-attempt permanent-delete action. */
  onDeleteEvidence?: () => Promise<void>;
}

/**
 * Presentational per-attempt report (PRO-26 + PRO-27 evidence viewer): a summary
 * header, a visual violation timeline, an expandable list of every logged
 * violation (with its evidence thumbnails), and the full capture gallery.
 * Renders purely from the contract — data fetching lives in
 * {@link AttemptReportPage}.
 */
export function AttemptReportView({
  report,
  evidence = [],
  onDeleteEvidence,
}: AttemptReportViewProps): JSX.Element {
  const { attempt, test, timeline } = report;
  // Timeline x-axis: prefer the configured duration; fall back to the last event.
  const durationMs = test.durationMinutes
    ? test.durationMinutes * 60_000
    : Math.max(0, ...timeline.map((v) => v.offsetMs));

  // Index evidence by id so each violation can show its linked captures.
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  // The item currently enlarged in the lightbox (null = closed).
  const [active, setActive] = useState<EvidenceItem | null>(null);

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
            <ViolationRow
              key={v.id}
              violation={v}
              evidenceById={evidenceById}
              onOpenEvidence={setActive}
            />
          ))}
        </ul>
      ) : null}

      <EvidenceGallery
        items={evidence}
        onOpen={setActive}
        onDeleteAll={onDeleteEvidence}
      />

      <EvidenceLightbox item={active} onClose={() => setActive(null)} />
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

/** One expandable violation row, with the evidence captured for it (PRO-27). */
function ViolationRow({
  violation,
  evidenceById,
  onOpenEvidence,
}: {
  violation: ReportViolation;
  evidenceById: Map<string, EvidenceItem>;
  onOpenEvidence: (item: EvidenceItem) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  // Resolve this violation's evidence ids to loaded items (some may be absent —
  // not yet uploaded, or already deleted).
  const linked = violation.evidenceIds
    .map((id) => evidenceById.get(id))
    .filter((e): e is EvidenceItem => e !== undefined);
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
        <div className="mt-3 pl-14">
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <Detail label="Started" value={formatClock(violation.startedAt)} />
            <Detail label="Ended" value={formatClock(violation.endedAt)} />
            <Detail
              label="Duration"
              value={formatDuration(violation.durationMs)}
            />
          </dl>
          <div className="mt-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Evidence
            </p>
            {linked.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {linked.map((item) => (
                  <EvidenceThumbnail
                    key={item.id}
                    item={item}
                    onOpen={onOpenEvidence}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm">
                {violation.evidenceIds.length > 0
                  ? `${violation.evidenceIds.length} item(s) — not available`
                  : "None"}
              </p>
            )}
          </div>
        </div>
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
