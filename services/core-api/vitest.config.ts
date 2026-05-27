import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    // Foundation tests do not hit Postgres; a dummy URL satisfies config
    // validation without opening a connection (pg.Pool connects lazily).
    env: {
      NODE_ENV: "test",
      DATABASE_URL:
        "postgres://proctoring:proctoring@localhost:5432/proctoring_test",
    },
  },
});
