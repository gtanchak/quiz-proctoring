# @proctoring/shared

The cross-boundary contract for the platform: types, the **violation event
schema**, and validation. Defined once here and imported by the proctoring SDK,
both web apps, and every backend service so client and server never drift.

Schemas use **TypeBox** (the project's locked validation library) — each schema
is JSON Schema, so the same definition powers runtime validation here, Fastify
request/response validation in the services, and static TS types.

## Violation event schema (PRO-50)

The most depended-on structure in the system: detectors emit violation events,
the ingestion service validates and stores them, and reporting / the Trust Score
read them. **Detection produces indicators, not verdicts** — `severity` is
advisory and raw events are always kept for human review.

### `ViolationEvent`

| Field | Type | Notes |
| -- | -- | -- |
| `schemaVersion` | integer | Schema version the event was produced against (defaults to current) |
| `id` | uuid | Client-generated event id — enables idempotent retries / dedup |
| `attemptId` | uuid | The attempt this event belongs to |
| `type` | enum | A known `VIOLATION_TYPES` value (e.g. `tab_switch`, `fullscreen_exit`, `multiple_faces`) |
| `severity` | enum | `info` / `low` / `medium` / `high` — advisory only |
| `startedAt` | date-time | Client-observed start. **Advisory evidence, not the server-authoritative test timer**; the ingestion service stamps its own receipt time |
| `endedAt?` | date-time \| null | End for ranged violations; absent/null if instantaneous |
| `durationMs?` | integer \| null | Optional duration for ranged violations |
| `evidenceIds?` | string[] | Ids of linked evidence (snapshots/clips) |
| `metadata?` | object | Type-specific extra data (e.g. face counts) |

`ViolationEventBatch` wraps `{ attemptId, events: ViolationEvent[] }` — the SDK
buffers events and flushes them in batches with retry.

### Validation

```ts
import { validateViolationEvent } from "@proctoring/shared";

const result = validateViolationEvent(input); // unknown -> typed result
if (result.valid) {
  // result.value is a ViolationEvent (defaults applied)
} else {
  // result.errors: string[] with field paths
}
```

`validateViolationEvent`, `validateViolationEventBatch`, and the `isViolationEvent`
guard run identically in the browser (SDK, before sending) and on the server
(ingestion, on receipt). Unknown fields and unknown types are rejected.

### Versioning rules

The schema is **versioned** (`VIOLATION_SCHEMA_VERSION`) so it can evolve without
breaking stored data or old reports:

- **Adding a new violation type:** append to the `VIOLATION_TYPES` registry and
  bump `VIOLATION_SCHEMA_VERSION`. Existing stored events keep validating —
  their types remain in the union — and old reports simply never contain the new
  type. Consumers should treat the type list as open-ended and ignore types they
  don't recognise.
- **Adding/changing a field:** bump `VIOLATION_SCHEMA_VERSION`. New fields should
  be optional so older events (without them) remain valid. Never repurpose or
  remove an existing field — that breaks historical data.
- Every event records the `schemaVersion` it was produced against, so consumers
  can branch on it if a migration is ever needed.

## Scripts

```bash
pnpm --filter @proctoring/shared build      # tsc -> dist
pnpm --filter @proctoring/shared test       # vitest
pnpm --filter @proctoring/shared typecheck
```
