import { DEFAULT_PROCTORING_REQUIREMENTS } from "@proctoring/shared";
import { useState } from "react";
import { PreTestCheck } from "./preflight/PreTestCheck.js";

/**
 * candidate-web entry. For now it hosts the pre-test device permission &
 * environment gateway (PRO-14); once the candidate clears it, the real
 * proctored attempt UI (timer + questions + SDK detectors) takes over — that is
 * later issues, so we show a placeholder.
 *
 * Per-test proctoring requirements will come from the test's public payload
 * once persisted (follow-up); until then we use the platform defaults.
 */
export function App(): JSX.Element {
  const [started, setStarted] = useState(false);

  if (started) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">You're all set</h1>
        <p className="mt-2 text-muted-foreground">
          Permissions granted. The proctored test would begin here.
        </p>
      </main>
    );
  }

  return (
    <PreTestCheck
      requirements={DEFAULT_PROCTORING_REQUIREMENTS}
      onReady={() => setStarted(true)}
    />
  );
}
