import type { AttemptReport } from "@proctoring/shared";
import { Alert, AlertDescription, AlertTitle } from "@proctoring/ui-components";
import { useEffect, useState } from "react";
import { getAttemptReport } from "../api/client.js";
import { AttemptReportView } from "./AttemptReportView.js";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; report: AttemptReport };

interface AttemptReportPageProps {
  attemptId: string;
  /** Injectable loader for tests; defaults to the real core-api client. */
  load?: (attemptId: string) => Promise<AttemptReport>;
}

const SHELL = "mx-auto max-w-3xl px-4 py-10";

/**
 * Data-fetching wrapper around {@link AttemptReportView}: handles the loading
 * and error states, then renders the report. The attempt id comes from the
 * (unguessable) report URL; access control is enforced server-side.
 */
export function AttemptReportPage({
  attemptId,
  load = getAttemptReport,
}: AttemptReportPageProps): JSX.Element {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    load(attemptId)
      .then((report) => active && setState({ status: "ready", report }))
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
  }, [attemptId, load]);

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

  return <AttemptReportView report={state.report} />;
}
