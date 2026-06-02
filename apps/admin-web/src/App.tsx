import { AttemptReportPage } from "./reports/AttemptReportPage.js";

/**
 * admin-web entry. A real router + auth shell lands with the admin dashboard
 * (PRO-30); for now we resolve the one route this app serves — the per-attempt
 * report (PRO-26) at `/reports/attempts/:attemptId` — directly from the path.
 * The attempt id is an unguessable UUID and access is enforced server-side.
 */
const REPORT_PATH = /^\/reports\/attempts\/([0-9a-f-]{36})\/?$/i;

export function App(): JSX.Element {
  const match =
    typeof window !== "undefined"
      ? window.location.pathname.match(REPORT_PATH)
      : null;

  if (match) {
    return <AttemptReportPage attemptId={match[1]} />;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Proctoring — Admin</h1>
      <p className="mt-2 text-muted-foreground">
        Open a per-attempt report at{" "}
        <code>/reports/attempts/&lt;attemptId&gt;</code>. The dashboard that links
        here arrives in a later issue.
      </p>
    </main>
  );
}
