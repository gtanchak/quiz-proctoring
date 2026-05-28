# @proctoring/violation-ingest

High-throughput intake for proctoring violation events (`PRO-25`). Every
detector in the SDK (tab switch, fullscreen, face, audio, copy-paste, …) posts
here; events are validated against the shared schema and persisted, append-only,
against the test attempt. This is the data backbone every report and the Trust
Score read from.

Deliberately **isolated from core-api** (CLAUDE.md §5): it is a separate
deployable with its own scaling, so a spike in violation traffic never slows
test-taking or the admin dashboard.

## Stack

- **Fastify 5** + **TypeBox** (`@fastify/type-provider-typebox`).
- **Drizzle ORM** + **PostgreSQL** — migrations via `drizzle-kit`.
- **`@proctoring/shared`** owns the violation event schema (`PRO-50`); the same
  definition validates on the client (before sending) and here (on receipt).
- Standard error envelope: `{ "error": { "code", "message", "details?" } }`.

## Data model

This service **owns and migrates** one table, `violations`
(`src/db/schema/violations.ts`):

- The client-generated event `id` is the primary key, so retried or duplicated
  events are idempotent (insert-or-ignore).
- `type`/`severity` are stored as `text` (not enums) so new violation types
  persist without a migration — the schema is versioned (`schema_version`) and
  old events keep validating.
- `started_at`/`ended_at` are the client's *observed* times (advisory evidence);
  `received_at` is the server-authoritative receipt time.

It also reads two **core-api-owned** tables for authentication —
`attempts` and `api_keys` — declared read-only in `src/db/schema/external.ts`.
They share the same Postgres instance but are never migrated from here.

## Prerequisites

- Node 22, pnpm 10 (see the repo root README).
- A running PostgreSQL. For local dev, start the bundled one from the repo root:

  ```bash
  docker compose up -d        # postgres on :5432
  ```

## Setup

```bash
cp services/violation-ingest/.env.example services/violation-ingest/.env
pnpm --filter @proctoring/violation-ingest db:migrate     # apply migrations
```

## Run

```bash
pnpm --filter @proctoring/violation-ingest dev      # tsx watch, reads .env
pnpm --filter @proctoring/violation-ingest build    # tsc -> dist/
pnpm --filter @proctoring/violation-ingest start    # node dist/server.js
```

- Health: `GET /health` (unversioned, no DB dependency)

## Authentication

- **Ingest** (`POST /v1/violations`) authenticates the candidate by their
  per-attempt **session token** (issued by core-api at attempt start, `PRO-8`),
  looked up by hash in `attempts`. A batch's `attemptId` must match the
  authenticated attempt.
- **Read** (`GET /v1/violations`) authenticates an admin/service **API key**
  (used by the reporting service), validated against `api_keys`.

Both expect `Authorization: Bearer <token>`. Per-token rate limiting guards the
ingest hot path; clients see `x-ratelimit-*` headers.

## Endpoints

| Method | Path | Auth | Notes |
| -- | -- | -- | -- |
| GET | `/health` | none | Liveness (unversioned) |
| POST | `/v1/violations` | attempt session token | Ingest a batch of events; idempotent by event id. Returns `{ accepted, stored, duplicates }` |
| GET | `/v1/violations?attemptId=…` | admin API key | An attempt's events in chronological order (`started_at` asc); `limit`/`offset` pagination |

## Database / migrations

```bash
pnpm --filter @proctoring/violation-ingest db:generate   # generate SQL from schema changes
pnpm --filter @proctoring/violation-ingest db:migrate    # apply pending migrations
```

Only `violations` is in the `drizzle-kit` schema glob; the external read-refs
are excluded so drizzle-kit never tries to create or alter core-api's tables.
Migrations are tracked in a dedicated `__drizzle_migrations_violation_ingest`
table, independent of core-api's journal in the shared database.

## Test

```bash
pnpm --filter @proctoring/violation-ingest test
```

Tests run against a dedicated, isolated `proctoring_violation_test` database
(created and migrated by `test/global-setup.ts`) with minimal stand-ins for the
core-api-owned `attempts`/`api_keys` tables — keeping this service's tests
independent of core-api. The foundation tests do not require a connection.
