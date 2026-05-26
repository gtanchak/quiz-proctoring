import { SHARED_CONTRACT_VERSION } from "@proctoring/shared";

/**
 * admin-web — PRO-46 skeleton. Renders nothing real yet; importing from
 * @proctoring/shared proves the shared contract is consumable from the admin
 * frontend too.
 */
export function App(): JSX.Element {
  return (
    <main>
      <h1>Proctoring — Admin</h1>
      <p>Skeleton app. Shared contract version: {SHARED_CONTRACT_VERSION}</p>
    </main>
  );
}
