# Runbook — CI/CD

The pipeline lives in `.github/workflows/ci.yml` (PRO-51). It runs on every pull
request and on pushes to `develop` / `main`.

## What CI runs

Three independent jobs (all must pass to merge):

1. **Lint, typecheck, build & test** — `pnpm install --frozen-lockfile`, then
   `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` (all Turbo-driven, so
   only affected packages do real work and the rest are cache hits). A
   `postgres:15-alpine` service backs the service tests; a step creates the
   `proctoring_test` database (core-api migrates it; violation-ingest creates
   its own `proctoring_violation_test`).
2. **Terraform fmt & validate** — `terraform fmt -check -recursive infra`, then
   `terraform init -backend=false && terraform validate` for `bootstrap` and each
   `environments/*`. No cloud credentials or remote state are touched.
3. **Build service images** — `docker build` for `core-api` and
   `violation-ingest` (matrix), `push: false`. Proves the images build; no
   registry push yet (see Deploy, below).

## Required status checks (repo admin, one-time)

CI can't enforce itself — enable branch protection in GitHub:

`Settings → Branches → Add rule` for `develop` and `main`:
- Require a pull request before merging.
- Require status checks to pass → select **Lint, typecheck, build & test**,
  **Terraform fmt & validate**, and **Build service images**.
- Require branches to be up to date before merging.

Once set, a failing build/test blocks merge (acceptance criterion).

## Known follow-up: Prettier gate

The repo predates the formatter and isn't normalised, so `pnpm format:check`
currently fails on ~46 files (including `CLAUDE.md` and READMEs). It is therefore
**not** a CI gate yet. To enable it: run `pnpm format` once (a `.prettierignore`
already excludes generated files), commit the normalization in its own PR, then
add a `pnpm format:check` step to the `check` job. ESLint runs in the meantime.

## Deploy (CD) — design, not yet wired

Deploy is intentionally deferred: the targets don't exist yet (no ECR repos, no
GitHub→AWS OIDC role, and PRO-52 created only the ECS **cluster**, not services
or task definitions). Wiring a deploy now would ship unrunnable config and
overlap PRO-38. The intended shape, to implement when services are first
deployed (with PRO-38 / the first service rollout):

- **Auth:** GitHub OIDC → a least-privilege AWS IAM role (no long-lived keys in
  the repo). Add the OIDC provider + role in `infra/` (Terraform).
- **Registry:** one ECR repository per service (Terraform); the deploy workflow
  builds and pushes the images this CI already builds.
- **Staging:** push to `develop` → build/push image → `aws ecs update-service`
  (or render task def + deploy) to the **staging** cluster — automatic.
- **Production:** gated via a GitHub **Environment** with required reviewers
  (manual approval / release promotion), deploying the same image to the
  **production** cluster.
- **Secrets:** injected at runtime from AWS Secrets Manager (e.g. the RDS
  master secret PRO-52 exposes) — never baked into images or the repo.

The Dockerfiles (`services/*/Dockerfile`) and this CI are the foundation that
work builds on.
