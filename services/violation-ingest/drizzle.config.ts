import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // Only the table this service owns — external read-refs are excluded.
  schema: "./src/db/schema/violations.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  migrations: { table: "__drizzle_migrations_violation_ingest" },
  strict: true,
  verbose: true,
});
