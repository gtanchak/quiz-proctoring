import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // esbuild (Vitest's default transform) does not emit the decorator metadata
  // NestJS DI needs, so transform with SWC instead.
  plugins: [
    swc.vite({
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    // The ingest/read routes hit Postgres; tests run against a dedicated,
    // isolated database (created and migrated by global-setup). The foundation
    // tests do not open a connection (pg.Pool connects lazily).
    env: {
      NODE_ENV: "test",
      DATABASE_URL:
        "postgres://proctoring:proctoring@localhost:5432/proctoring_violation_test",
    },
  },
});
