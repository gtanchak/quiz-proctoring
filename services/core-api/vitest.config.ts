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
      // Cheap scrypt parameters so password hashing doesn't slow the suite.
      SCRYPT_N: "1024",
      SCRYPT_R: "8",
      SCRYPT_P: "1",
      // Short TTLs are fine for tests; sessions are exercised directly.
      SESSION_TTL: "3600",
      SESSION_ABS_TTL: "7200",
    },
  },
});
