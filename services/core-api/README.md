# @proctoring/core-api

The core REST API (Fastify): tests, attempts, users, and the public API surface.
Authoritative for the test timer. Part of the `PRO-33` REST API foundation.

## Stack

- **Fastify 5** + **TypeBox** (`@fastify/type-provider-typebox`) — route schemas
  are JSON Schema, so validation (Ajv) and the OpenAPI spec share one source.
- **Drizzle ORM** + **PostgreSQL** — migrations via `drizzle-kit`.
- Standard error envelope: `{ "error": { "code", "message", "details?" } }`.

## Prerequisites

- Node 22, pnpm 10 (see the repo root README).
- A running PostgreSQL. For local dev, start the bundled one from the repo root:

  ```bash
  docker compose up -d        # postgres on :5432, dev + test databases
  ```

## Setup

```bash
cp services/core-api/.env.example services/core-api/.env   # then edit if needed
pnpm --filter @proctoring/core-api db:migrate               # apply migrations
```

## Run

```bash
pnpm --filter @proctoring/core-api dev      # tsx watch, reads .env
pnpm --filter @proctoring/core-api build    # tsc -> dist/
pnpm --filter @proctoring/core-api start    # node dist/server.js (needs env)
```

- Health: `GET /health` (unversioned, no DB dependency)
- OpenAPI docs (Swagger UI): `GET /docs`

## Authentication

All `/v1` routes require an API key: `Authorization: Bearer <key>`. Keys are
stored hashed (SHA-256) with an indexed prefix; the raw key is shown once.

Bootstrap the first key (before the accounts system, `PRO-39`, exists):

```bash
pnpm --filter @proctoring/core-api key:create "My key name"
```

Per-key rate limiting is enforced; clients see `x-ratelimit-*` headers.

## Database / migrations

```bash
pnpm --filter @proctoring/core-api db:generate   # generate SQL from schema changes
pnpm --filter @proctoring/core-api db:migrate    # apply pending migrations
```

Schema lives in `src/db/schema/`. Tables that reference each other are
co-located in one file (drizzle-kit cannot follow cross-file `.js` imports);
new table modules must be added to the `schema` object in `src/db/client.ts`.

## Test

```bash
pnpm --filter @proctoring/core-api test
```

Tests run against the `proctoring_test` database (created by the compose init
script). A global setup migrates it before the suite; the foundation tests do
not require a database connection.

## Endpoints (current)

| Method | Path | Notes |
| -- | -- | -- |
| GET | `/health` | Liveness (unversioned) |
| GET | `/v1/me` | Identity of the authenticated key |
| POST | `/v1/tests` | Create a test (draft) |
| GET | `/v1/tests` | List (pagination, `status` filter, `sort`/`order`) |
| GET | `/v1/tests/:id` | Read |
| PATCH | `/v1/tests/:id` | Update config (blocked while published with attempts in progress) |
| DELETE | `/v1/tests/:id` | Delete (same guard) |
| POST | `/v1/tests/:id/publish` | Publish — validates ≥1 question and a valid window |
| POST | `/v1/tests/:id/unpublish` | Return to draft |
| POST | `/v1/tests/:testId/questions` | Add an MCQ question |
| GET | `/v1/tests/:testId/questions` | List a test's questions |
| GET | `/v1/tests/:testId/questions/:questionId` | Read a question |
| PATCH | `/v1/tests/:testId/questions/:questionId` | Update a question |
| DELETE | `/v1/tests/:testId/questions/:questionId` | Delete a question |
| POST | `/v1/tests/:testId/invites` | Invite a candidate email (invite-only) |
| GET | `/v1/tests/:testId/invites` | List invited emails |
| DELETE | `/v1/tests/:testId/invites/:inviteId` | Remove an invite |
| POST | `/v1/tests/:testId/attempts` | Admin-start an attempt (published only) |
| GET | `/v1/tests/:id/attempts` | List a test's attempts |
| GET | `/v1/attempts/:id` | Read an attempt (auto-submits if past deadline) |
| POST | `/v1/attempts/:id/submit` | Submit and lock an attempt |
| GET | `/v1/attempts/:id/responses` | Per-question responses & awarded points (review) |

### Candidate (public) endpoints — no admin key

| Method | Path | Notes |
| -- | -- | -- |
| GET | `/v1/public/tests/:token` | Landing info + link state (`not_yet_open`/`open`/`closed`) |
| POST | `/v1/public/tests/:token/start` | Start (201) or resume (200) an attempt; returns a session token |
| GET | `/v1/public/attempt` | Read the current attempt (session-token auth) |
| PUT | `/v1/public/attempt/answers` | Save/replace answers (in-progress only) |
| POST | `/v1/public/attempt/submit` | Submit the current attempt (session-token auth) |
| GET | `/v1/public/attempt/result` | Score + per-question breakdown (after submit) |

A test carries config: `durationMinutes`, `availableFrom`/`availableUntil`
window, `maxAttempts`, scoring (`passMark`, `negativeMarking`), and
`draft`/`published` status. Status changes only via publish/unpublish, never via
PATCH.

Questions (PRO-6) support MCQ — single- and multi-correct. Options are sent with
a `correct` flag; the server assigns option ids and derives the correct set.
Auto-grading lives in `src/lib/grading.ts` (`gradeMcq`): single and multi
all-or-nothing, plus a configurable `partial` mode with optional negative
marking. Candidate-side rendering and answer capture are the attempt-taking flow
(PRO-7/PRO-8); the authoring UI is admin-web (after PRO-39).

### Server-authoritative timer (PRO-7)

`deadline_at` is set from the **server** clock when an attempt starts
(`started_at + test.duration_minutes`; null = untimed). Remaining time is always
computed server-side (`src/lib/timer.ts`), so a refresh or brief disconnect
resumes from true elapsed time and the client cannot buy extra time. An attempt
past its deadline is auto-submitted and locked the next time it is read or
submitted (lazy expiry; a background sweep is a V1 refinement). Candidate-facing
access (links, invite, sessions, max-attempts, resume) is **PRO-8** (below); the
countdown UI is candidate-web.

### Candidate access via share links (PRO-8)

Every test gets an opaque `access_token` (the share link id) at creation. The
link only admits candidates once the test is published and within its
availability window (`linkState` in `src/lib/access.ts`). Access is `open`
(anyone with the link) or `invite` (email must be on the test's allow-list).

Candidates authenticate via the `/v1/public/*` surface (excluded from the admin
auth hook): the landing is open; starting an attempt issues a per-attempt
**session token** (hashed at rest, returned once), which authorizes the
poll/answers/submit endpoints. Starting enforces the link state, invite
allow-list, and `max_attempts`, and **resumes** an existing in-progress attempt
(re-issuing a session token) rather than creating a duplicate. The candidate
landing/countdown UI lives in candidate-web.

### Answer capture & auto-grading (PRO-53)

During an in-progress attempt a candidate saves answers via
`PUT /v1/public/attempt/answers` (one `responses` row per question, upserted).
On **submit** — and on deadline **auto-expiry** — the attempt is graded:
`src/lib/grade-attempt.ts` runs each saved answer through `gradeMcq` and persists
per-response `awarded_points` plus the attempt's `score`/`max_score`. Candidates
read their `score` + per-question breakdown at `/v1/public/attempt/result`
(never the correct answers); admins review responses at
`/v1/attempts/:id/responses`. Unanswered questions score 0 but still count toward
`max_score`.

All `/v1` resources are scoped to the calling API key; another tenant's rows
return `404`.

### Not yet implemented (depend on other issues)

- Questions (`PRO-6` and related), reports & violations read (`PRO-50` schema /
  `PRO-25` ingest), evidence signed-URL retrieval (`PRO-27`, V1).
- API-key management endpoints (list/revoke) — arrive with the accounts system
  (`PRO-39`); for now keys are created via the `key:create` script.
