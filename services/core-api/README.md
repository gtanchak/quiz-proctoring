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
| POST | `/v1/tests` | Create a test |
| GET | `/v1/tests` | List (pagination, `status` filter, `sort`/`order`) |
| GET | `/v1/tests/:id` | Read |
| PATCH | `/v1/tests/:id` | Update |
| DELETE | `/v1/tests/:id` | Delete |
| GET | `/v1/tests/:id/attempts` | List a test's attempts |
| GET | `/v1/attempts/:id` | Read an attempt |

All `/v1` resources are scoped to the calling API key; another tenant's rows
return `404`.

### Not yet implemented (depend on other issues)

- Questions (`PRO-6` and related), reports & violations read (`PRO-50` schema /
  `PRO-25` ingest), evidence signed-URL retrieval (`PRO-27`, V1).
- API-key management endpoints (list/revoke) — arrive with the accounts system
  (`PRO-39`); for now keys are created via the `key:create` script.
