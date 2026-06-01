# syntax=docker/dockerfile:1
#
# Multi-stage, monorepo-aware image for @proctoring/violation-ingest.
# Build context is the REPOSITORY ROOT (see .github/workflows/ci.yml and
# .dockerignore) so pnpm can resolve the workspace and the @proctoring/shared
# dependency. `pnpm deploy` produces a self-contained tree (prod deps + built
# dist) that the runtime stage runs directly.

FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable

# Whole workspace is needed: the lockfile references every workspace package, so
# a partial copy would fail `--frozen-lockfile`. node_modules/dist are excluded
# via .dockerignore.
COPY . .

RUN pnpm install --frozen-lockfile
# Turbo builds the @proctoring/shared dependency first (^build), then the service.
RUN pnpm exec turbo run build --filter=@proctoring/violation-ingest
# Self-contained deployable (prod deps + the built package) at /out. --legacy
# copies the @proctoring/shared workspace dep in (pnpm 10 needs this unless
# inject-workspace-packages is enabled).
RUN pnpm --filter @proctoring/violation-ingest --prod deploy --legacy /out

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out .
USER node
EXPOSE 3002
CMD ["node", "dist/server.js"]
