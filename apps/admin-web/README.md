# @proctoring/admin-web

The admin app — test authoring, dashboard, and **proctoring reports** (React +
Vite). UI is built on the shared design system (`@proctoring/ui-components`,
shadcn/ui + Tailwind v4); cross-boundary types come from `@proctoring/shared`.

## Per-attempt report (PRO-26)

The report an admin opens to review one candidate's attempt: a summary header
(candidate, test, timing, score, outcome), a **visual violation timeline**
aligned to the test duration, and an expandable row per violation.

- **Route:** `/reports/attempts/:attemptId`. The attempt id is an unguessable
  UUID and access is enforced server-side (the report is scoped to the test's
  owning org — a non-owner gets a 404). A real router + auth shell lands with
  the dashboard (PRO-30); for now `App.tsx` resolves this one route from the
  path.
- **Data:** `src/api/client.ts` calls core-api `GET /v1/attempts/:id/report`,
  which is a **BFF** — it owner-scopes the attempt and test from its own store
  and fetches the violation timeline from the isolated `violation-ingest`
  service over HTTP (the two services do not share a table; see CLAUDE.md §5).
  The response is validated against the shared `AttemptReport` contract before
  it reaches the UI.
- **Components** (`src/reports/`): `AttemptReportPage` (loading/error/data),
  `AttemptReportView` (presentational), `ViolationTimeline` (the visual track),
  `violation-display.ts` (labels, severity → badge/marker, formatting).
- **Evidence:** each violation carries its `evidenceIds`; thumbnails/playback
  are wired in by the V1 evidence viewer (PRO-27).

Detection produces **indicators, not verdicts** — the score and severities are
advisory; the report preserves the underlying events for human review.

## Configuration

`VITE_CORE_API_URL` — base URL of core-api (default `http://localhost:3001`).
The admin session token is read from `localStorage["admin_session_token"]`
until the login flow lands.

## Scripts

```bash
pnpm --filter @proctoring/admin-web dev    # vite dev server (port 5174)
pnpm --filter @proctoring/admin-web test   # vitest (jsdom + Testing Library)
pnpm --filter @proctoring/admin-web build  # tsc --noEmit + vite build
```
