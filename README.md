# Proctoring & Assessment Platform

Remote proctoring and online assessment platform. Monorepo containing the
candidate and admin web apps, the embeddable proctoring SDK, the backend
services, shared contracts, and infrastructure.

> Read [`CLAUDE.md`](./CLAUDE.md) and the **Development Architecture** document
> (Linear, Proctoring team) before contributing. The technology stack is locked.

## Tooling

- **Package manager / workspaces:** [pnpm](https://pnpm.io) workspaces
- **Build orchestration & caching:** [Turborepo](https://turbo.build)
- **Language:** TypeScript (`strict`), one Python service (CV) added in V1
- **Lint / format:** ESLint + Prettier (shared config at the repo root)

## Prerequisites

- **Node.js >= 22**
- **pnpm 10** — enable via Corepack: `corepack enable && corepack prepare pnpm@10.22.0 --activate`

## Install

```bash
pnpm install
```

## Common commands

All commands run from the repo root and fan out across the workspace via Turborepo:

| Command | What it does |
| -- | -- |
| `pnpm build` | Build every package/app/service (respects dependency order) |
| `pnpm lint` | Lint all workspaces |
| `pnpm typecheck` | Type-check all workspaces without emitting |
| `pnpm test` | Run all workspace tests |
| `pnpm dev` | Run the dev task of every workspace that defines one |
| `pnpm format` | Format the whole repo with Prettier |

Target a single workspace with Turborepo's filter, e.g.:

```bash
pnpm build --filter @proctoring/shared
pnpm --filter @proctoring/candidate-web dev
```

## Continuous integration

Every pull request (and push to `develop`/`main`) runs
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml): lint + typecheck +
build + test (against a Postgres service), `terraform fmt`/`validate` over
`infra/`, and a `docker build` of each service image. See
[`docs/runbooks/ci-cd.md`](./docs/runbooks/ci-cd.md) for the pipeline, the
required-status-checks setup, and the deferred deploy design.

## Repository layout

```
packages/
  shared/          @proctoring/shared — types, violation schema, validation (the contract)
  proctoring-sdk/  @proctoring/proctoring-sdk — embeddable SDK (NO React dependency)
  ui-components/   @proctoring/ui-components — shared React components for the web apps
apps/
  candidate-web/   Candidate test-taking app (React + Vite)
  admin-web/       Admin authoring + dashboard + reports (React + Vite)
services/
  core-api/        Tests, attempts, users, public REST API (Fastify)
  violation-ingest/ High-throughput violation event intake (Fastify)
infra/             Infrastructure-as-code (Terraform) — dev/staging/production (PRO-52)
docs/              Architecture, API reference, runbooks
```

### Reserved for later phases (not yet created)

These directories are part of the architecture but are intentionally **not**
scaffolded until their phase, to avoid building ahead of schedule:

- `services/evidence/` — uploads, signed URLs, retention (**V1**; in MVP, basic
  evidence handling lives inside `core-api`)
- `services/reporting/` — reports, Trust Score, analytics, exports (**V1**)
- `services/cv-service/` — face / ID / impersonation, Python + FastAPI (**V1**)
- `services/code-sandbox/` — Judge0-based coding-question judge (**V2**)
- `services/workers/` — background jobs: exports, CV jobs, purges, webhooks (**V1**)

## Running the stubs

The MVP packages currently exist as minimal, building stubs (this is the
`PRO-46` skeleton — no app logic yet):

- **Web apps:** `pnpm --filter @proctoring/candidate-web dev` (and `admin-web`) start Vite dev servers.
- **Services:** `pnpm --filter @proctoring/core-api dev` (and `violation-ingest`) start the Fastify stub via `tsx`, exposing a `GET /health` route.
