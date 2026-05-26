import { SHARED_CONTRACT_VERSION } from "@proctoring/shared";

/**
 * candidate-web — PRO-46 skeleton. Renders nothing real yet; importing from
 * @proctoring/shared proves the shared contract is consumable (and
 * type-checks) from a frontend app.
 */
export function App(): JSX.Element {
  return (
    <main>
      <h1>Proctoring — Candidate</h1>
      <p>Skeleton app. Shared contract version: {SHARED_CONTRACT_VERSION}</p>
    </main>
  );
}
