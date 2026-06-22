import type { AttemptReport, EvidenceItem } from "@proctoring/shared";
import { Alert, AlertDescription, AlertTitle } from "@proctoring/ui-components";
import { useCallback, useEffect, useState } from "react";
import {
  deleteAttemptEvidence,
  getAttemptEvidence,
  getAttemptReport,
} from "../api/client.js";
import { AttemptReportView } from "./AttemptReportView.js";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; report: AttemptReport; evidence: EvidenceItem[] };

interface AttemptReportPageProps {
  attemptId: string;
  /** Injectable loaders for tests; default to the real core-api client. */
  load?: (attemptId: string) => Promise<AttemptReport>;
  loadEvidence?: (attemptId: string) => Promise<EvidenceItem[]>;
  deleteEvidence?: (attemptId: string) => Promise<number>;
}

const SHELL = "mx-auto max-w-3xl px-4 py-10";

const defaultLoadEvidence = (attemptId: string): Promise<EvidenceItem[]> =>
  getAttemptEvidence(attemptId).then((r) => r.items);

/**
 * Data-fetching wrapper around {@link AttemptReportView}: loads the report and
 * its evidence (PRO-27), handles loading/error states, and wires the
 * permanent-delete action. The attempt id comes from the (unguessable) report
 * URL; access control is enforced server-side.
 *
 * Evidence is fetched best-effort: if it fails (e.g. it was already deleted),
 * the report still renders with an empty gallery rather than erroring the page.
 */
export function AttemptReportPage({
  attemptId,
  load = getAttemptReport,
  loadEvidence = defaultLoadEvidence,
  deleteEvidence = deleteAttemptEvidence,
}: AttemptReportPageProps): JSX.Element {
  const [state, setState] = useState<State>({ status: "loading" });

  const refreshEvidence = useCallback(async () => {
    const items = await loadEvidence(attemptId).catch(() => []);
    setState((prev) =>
      prev.status === "ready" ? { ...prev, evidence: items } : prev,
    );
  }, [attemptId, loadEvidence]);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    Promise.all([
      load(attemptId),
      loadEvidence(attemptId).catch(() => [] as EvidenceItem[]),
    ])
      .then(
        ([report, evidence]) =>
          active && setState({ status: "ready", report, evidence }),
      )
      .catch(
        (err: unknown) =>
          active &&
          setState({
            status: "error",
            message:
              err instanceof Error ? err.message : "Failed to load the report.",
          }),
      );
    return () => {
      active = false;
    };
  }, [attemptId, load, loadEvidence]);

  const handleDeleteEvidence = useCallback(async () => {
    await deleteEvidence(attemptId);
    await refreshEvidence();
  }, [attemptId, deleteEvidence, refreshEvidence]);

  if (state.status === "loading") {
    return (
      <main className={SHELL}>
        <p className="text-sm text-muted-foreground">Loading report…</p>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className={SHELL}>
        <Alert variant="destructive">
          <AlertTitle>Couldn't load this report</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <AttemptReportView
      report={state.report}
      evidence={state.evidence}
      onDeleteEvidence={handleDeleteEvidence}
    />
  );
}
