# ADR 0001 — Backend service boundaries (microservices)

- **Status:** Accepted (MVP); one item tracked for V1 (see Consequences → PRO-54)
- **Date:** 2026-06-03
- **Context source:** backend architecture review

## Context

The platform is built as **microservices**: independently deployable backend
services, split by business capability, communicating over APIs and an async
queue, sharing only a *contract* package — not code-by-reference or in-process
calls. This ADR records what "microservices" means here concretely, so the
boundaries are intentional and reviewable rather than incidental.

The Development Architecture document plans **seven** services
(`core-api`, `violation-ingest`, `evidence`, `reporting`, `cv-service`,
`code-sandbox`, `workers`). The build is **phased**: MVP ships only `core-api`
and `violation-ingest`; the rest arrive in their phases. A small service count
today is by design, not a monolith.

## Decision

### Service boundaries

| Service | Capability | Runtime |
| -- | -- | -- |
| `core-api` | Tests, questions, attempts, accounts/auth, server-authoritative timer, per-attempt reports (BFF) | Node + Fastify (port 3001) |
| `violation-ingest` | High-throughput violation event intake + a read API for reporting | Node + Fastify (port 3002) |

Each service:

- is an **independently deployable unit** — its own `Dockerfile`, `config.ts`,
  port, and ECS Fargate task definition; scalable on its own;
- **owns its schema and migrations** — `core-api` owns `accounts`, `api_keys`,
  `tests`/`questions`/`attempts`/`responses`; `violation-ingest` owns
  `violations` (with its own `__drizzle_migrations_violation_ingest` table);
- shares **only the contract** via `@proctoring/shared` (types + validation),
  never another service's internal modules.

### Why `violation-ingest` is separate

Violation traffic is bursty and high-volume. Isolating ingestion guarantees a
spike can never slow test-taking or the admin dashboard (CLAUDE.md §5). This is
the canonical reason to split a service, and it is the load-bearing boundary in
the system today.

### Inter-service communication

- **Synchronous, over HTTP:** `core-api` → `violation-ingest` to read the
  violation timeline when assembling a report (`HttpViolationsClient`,
  `VIOLATION_INGEST_URL`). `core-api` is the BFF/aggregator for the admin UI; it
  never reaches into `violation-ingest`'s tables.
- **Asynchronous, over SQS:** out-of-band work (CV inference, evidence
  processing) is queued so the candidate flow never blocks on it.
- **Contract:** all cross-boundary payloads are defined once in
  `@proctoring/shared` and validated on both sides.

### Data ownership

The target is **database-per-service** data ownership. In MVP the services share
a single RDS *instance* (`DATABASE_URL`) for cost, but each service is the sole
owner of its own tables. Cross-service data is reached through the owning
service's API (e.g. the reports read path above).

## Known deviation (and remediation)

`violation-ingest` currently reads **`core-api`-owned tables directly** to
authenticate on the ingest hot path —
`services/violation-ingest/src/db/schema/external.ts` declares read-only refs to
`attempts` (candidate session token) and `api_keys` (admin read API). This is a
shared-database coupling: a schema change in `core-api` can break
`violation-ingest`.

It was a deliberate MVP tradeoff — it avoids a synchronous `core-api` call on
**every** violation batch, which would re-couple the hot path we isolated. But it
weakens data ownership and is the one place the architecture diverges from
textbook microservices.

**Remediation (V1): [PRO-54].** Make the candidate session token
self-verifiable (signed HMAC/JWT) so `violation-ingest` validates it
cryptographically with no `attempts` read; move the admin API-key check off the
shared `api_keys` table; then delete `external.ts`. This removes the cross-service
table dependency without adding a hot-path call.

## Consequences

- ✅ Services deploy and scale independently; the ingest load path is isolated.
- ✅ Clear ownership of schemas, migrations, and contracts.
- ⚠️ Until [PRO-54], `core-api` schema changes to `attempts`/`api_keys` must
  consider `violation-ingest`'s read-only dependency (the columns it reads are
  enumerated in `external.ts` — treat them as a contract).
- 📋 New services (`evidence`, `reporting`, `cv-service`, `code-sandbox`,
  `workers`) follow this ADR: own their data, talk over API/queue, share only
  `@proctoring/shared`.

[PRO-54]: https://linear.app/proctoring/issue/PRO-54
