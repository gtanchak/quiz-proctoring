import { defineConfig } from "vitest/config";

export default defineConfig({
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
