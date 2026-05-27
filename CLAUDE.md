# CLAUDE.md — Proctoring & Assessment Platform

> This file is the root context for AI coding tools (Claude Code and others).
> Read it fully before generating or modifying any code. It is the single
> source of truth for stack, structure, and conventions. When this file and a
> prompt disagree, ask — do not silently override this file.
>
> Companion documents (in Linear, Proctoring team):
> - **Development Architecture** — full architecture and rationale
> - **Product Roadmap** — phases (MVP / V1 / V2) and scope
> Linear issues are identified as `PRO-N` throughout.

---

## 1. What this project is

A remote proctoring and online assessment platform (an AutoProctor-style
product). Two products in one codebase:

1. A standalone web application — admins create tests, candidates take them,
   admins review proctoring reports.
2. An embeddable white-label **proctoring SDK** that runs inside other
   companies' websites.

Proctoring runs **in the candidate's browser in real time** — camera/mic/screen
permissions, periodic snapshots, tab-switch / fullscreen / face / audio
detection. Detected events ("violations") stream to the backend. Reports are
assembled from the violation log; a 0–100% "Trust Score" summarises them.

Key product principle: detection produces **indicators, not verdicts**. The
Trust Score is advisory. Never design logic that auto-passes or auto-fails a
candidate purely on a score. Always preserve the underlying evidence for human
review.

---

## 2. Locked technology stack — do NOT substitute

These are final decisions. Do not introduce alternatives without an explicit
instruction to change this file.

| Layer | Technology |
| -- | -- |
| Language (everything except CV) | TypeScript |
| Web apps | React + TypeScript, built with Vite |
| Proctoring SDK | TypeScript, framework-agnostic, **no React dependency** |
| Backend services | Node.js + TypeScript, **Fastify** |
| CV/ML service | Python + FastAPI, wrapping **AWS Rekognition** |
| Code execution sandbox | **Judge0**, self-hosted |
| Database | PostgreSQL (AWS RDS) |
| Object storage | AWS S3 |
| Cache / sessions | Redis |
| Async job queue | AWS SQS |
| Cloud provider | **AWS** (ECS Fargate, RDS, S3, SQS, CloudFront) |
| Infrastructure as code | Terraform |
| Monorepo tooling | **pnpm workspaces + Turborepo** |
| PostgreSQL ORM / query layer | **Drizzle ORM** (migrations via drizzle-kit) |
| Fastify schema / validation | **TypeBox** (`@sinclair/typebox`) |

**Backend framework is Fastify, not NestJS** — do not generate NestJS
decorators, modules, or DI. Use Fastify plugins and plain route handlers.

**Monorepo tooling — decided (`PRO-46`):** pnpm workspaces for dependency and
workspace management, with Turborepo for build/lint/test orchestration and
caching. Internal packages are `@proctoring/<name>` and referenced by the
`workspace:*` protocol, never relative paths across package boundaries.

**PostgreSQL ORM / query layer — decided (`PRO-33`):** Drizzle ORM. TS-first,
explicit and SQL-shaped (no hidden runtime magic — same rationale as the
Fastify choice); schema-inferred types, migrations managed with `drizzle-kit`.
Used by every TypeScript service that touches Postgres.

**Fastify validation — decided (`PRO-33`):** TypeBox (`@sinclair/typebox`) via
`@fastify/type-provider-typebox`. Route schemas are JSON Schema, so Fastify
validates natively (Ajv) and the OpenAPI spec generates from the same source.
The same definitions back the `shared` contract (`PRO-50`). Prefer one TypeBox
schema as the single source for both runtime validation and static types.

**Still open** (decide when you reach the relevant issue, then record the
choice here): the WebSocket gateway implementation. Do not pick this
unilaterally for unrelated work.

---

## 3. Repository structure

Monorepo. Keep code in the correct location; do not invent new top-level dirs.

```
proctoring-platform/
├── packages/
│   ├── shared/              # Types, violation schema, validation — used everywhere
│   ├── proctoring-sdk/      # Standalone embeddable SDK (NO React dependency)
│   └── ui-components/       # Shared React components for the two web apps
├── apps/
│   ├── candidate-web/       # Candidate test-taking app (React)
│   └── admin-web/           # Admin authoring + dashboard + reports (React)
├── services/
│   ├── core-api/            # Tests, attempts, users, public REST API (Fastify)
│   ├── violation-ingest/    # High-throughput violation event intake (Fastify)
│   ├── evidence/            # Uploads, signed URLs, retention (Fastify)
│   ├── reporting/           # Reports, Trust Score, analytics, exports (Fastify)
│   ├── cv-service/          # Face / ID / impersonation (Python, FastAPI)
│   ├── code-sandbox/        # Coding-question execution judge (Judge0)
│   └── workers/             # Background jobs (Node/TS)
├── infra/                   # Terraform, per environment
└── docs/                    # Architecture, API reference, runbooks
```

The layout is phase-aware. MVP touches only `shared`, `candidate-web`,
`admin-web`, `core-api`, `violation-ingest`, and `infra`. Do not create or
build the other services until their phase — but never relocate the structure.

Note the MVP scope of two V1 services lives inside MVP services for now:
**basic evidence handling** (signed-URL snapshot uploads to S3) is implemented
inside `core-api` in MVP — the standalone `evidence/` service is extracted in
V1. Likewise the **Trust Score is not computed in MVP**; MVP captures and
stores the violation log (via `violation-ingest`), and the `reporting/` service
that computes the Trust Score from that log arrives in V1. Do not stand up
`evidence/` or `reporting/` as separate services before V1.

---

## 4. The shared package is the contract

`packages/shared` holds the violation event schema, API types, and validation
logic. It is imported by the SDK, both web apps, and every backend service.

- All cross-boundary data shapes (anything sent browser↔server) are defined
  **once** in `shared`. Never redefine a type locally that already exists there.
- The **violation event schema** is the most depended-on structure in the
  system. It is versioned. Adding a new violation type must not break existing
  stored data or old reports.
- Validation logic in `shared` runs on both sides: the client validates before
  sending, the server validates on receipt.

If a task needs a new shared type, add it to `shared` — do not work around it.

---

## 5. Architectural rules that must hold

These follow from the architecture and must not be violated by generated code:

- **The test timer is server-authoritative.** The server records the true
  start time. The browser only *displays* a countdown. Never trust the client
  clock for timing, expiry, or auto-submit. Refresh/disconnect/reconnect must
  resolve against server time.
- **No proctoring video leaves the device.** Detection runs client-side in the
  browser. Only discrete violation events and periodic still snapshots/short
  clips are uploaded — never a continuous webcam video stream. (Screen
  *session recording*, a V1 feature, is the one explicit exception and is
  clearly scoped as such.)
- **The proctoring SDK has no React dependency.** It must embed in any host
  page. Keep it framework-agnostic and self-contained.
- **Violation ingestion is isolated** from the Core API. A spike in violation
  traffic must never slow down test-taking or the admin dashboard.
- **CV work is asynchronous.** The candidate flow never blocks on model
  inference. Capture → queue → process out-of-band → attach results later.
- **Evidence is private.** All evidence (snapshots, audio, ID images,
  recordings) is served only via signed, time-limited URLs. Never a public or
  guessable link.
- **The code sandbox is fully isolated** — network-disabled, resource-capped,
  on separate infrastructure. Untrusted candidate code must never reach core
  infra.

---

## 6. Security & privacy (non-negotiable)

The platform handles webcam images, audio, ID documents, and screen recordings,
often of minors. Treat privacy as structural.

- TLS everywhere. Encryption at rest for database and S3.
- Secrets come from a managed secrets store / environment — **never commit
  secrets, keys, or credentials**, and never hard-code them in source.
- Candidate consent is captured before any capture begins.
- Data retention and a true permanent-delete path are built in from the start,
  not retrofitted.
- Do not log personal data or evidence URLs in plaintext application logs.
- ID documents and biometric data are the most sensitive class — handle with
  the strictest controls.

---

## 7. How to work, issue by issue

Work is tracked in Linear as `PRO-N` issues, grouped into projects and phases
(Phase 0 / Foundation → MVP → V1 → V2).

- **Do one issue at a time.** Implement against the issue's stated scope and
  acceptance criteria. Do not pull scope forward from later issues.
- **Respect the build order.** Foundational issues come first:
  `PRO-46` (monorepo + shared package) and `PRO-50` (violation event schema)
  underpin almost everything — build them before anything that imports from
  `shared`.
- **Check dependencies before starting.** If an issue depends on another,
  build against the real, existing code — do not stub a dependency that is
  supposed to already exist.
- If an issue's spec is ambiguous or seems to conflict with this file, **stop
  and ask** rather than guessing.
- Do not duplicate functionality that already exists in another package or
  service — import it.

---

## 8. Code conventions

- **TypeScript:** `strict` mode on. No implicit `any`. Prefer explicit types on
  exported/public APIs. Type cross-boundary data via the `shared` package.
- **Fastify services:** plugins + plain route handlers. Validate request and
  response payloads with schemas. Consistent, machine-readable error shapes.
  Versioned API base path (`/v1/...`).
- **React apps:** functional components and hooks. Shared UI goes in
  `packages/ui-components`.
- **Python (cv-service only):** FastAPI, type hints throughout.
- **Tests:** every service and package has tests. Proctoring detectors need
  broad cross-browser testing — browser behaviour around tabs, fullscreen, and
  media permissions is inconsistent and is where bugs hide.
- **Naming:** clear and descriptive. Match existing patterns in the file or
  package you are editing.
- **Commits:** small, focused, one concern each; reference the `PRO-N` issue.
- **Formatting/linting:** follow the repo's configured linter and formatter.
  Do not hand-introduce a different style.

---

## 9. Things NOT to do

- Do not swap any locked technology in section 2.
- Do not generate NestJS-style code — this is a Fastify project.
- Do not add a React dependency to `packages/proctoring-sdk`.
- Do not redefine in one package a type that already lives in `shared`.
- Do not trust the client clock for test timing.
- Do not upload continuous webcam video, or design server-side webcam
  recording (snapshots only; screen session recording in V1 is the sole,
  explicitly scoped exception).
- Do not commit secrets or credentials.
- Do not auto-pass/fail a candidate from a score alone — preserve evidence for
  human review.
- Do not build services for a later phase before their phase.
- Do not create accounts, provision cloud resources, or run destructive
  commands as a side effect of a coding task.

---

## 10. When unsure

If a request is ambiguous, conflicts with this file, or would require changing
a locked decision: pause and ask the human. A clarifying question is always
cheaper than rework. This file can be changed — but only deliberately, by an
explicit instruction to update it, never as a side effect.
