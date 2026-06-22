import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/**
 * Typed, validated runtime configuration for core-api.
 *
 * Environment is the single source of config (CLAUDE.md §6: secrets come from
 * the environment, never source). We validate it once at startup and fail fast
 * with a clear message if anything is missing or malformed — better a loud
 * boot failure than a subtle runtime one.
 */
const ConfigSchema = Type.Object({
  NODE_ENV: Type.Union(
    [
      Type.Literal("development"),
      Type.Literal("test"),
      Type.Literal("production"),
    ],
    { default: "development" },
  ),
  HOST: Type.String({ default: "0.0.0.0" }),
  PORT: Type.Number({ default: 3001 }),
  LOG_LEVEL: Type.String({ default: "info" }),
  /** PostgreSQL connection string. Required — the API is useless without it. */
  DATABASE_URL: Type.String({ minLength: 1 }),
  /** Max requests per window, per API key (or per IP for unauthenticated routes). */
  RATE_LIMIT_MAX: Type.Number({ default: 100 }),
  /** Rate-limit window, e.g. "1 minute", "15 seconds". */
  RATE_LIMIT_WINDOW: Type.String({ default: "1 minute" }),

  // --- Accounts & auth (PRO-39) ---------------------------------------------
  /** Sliding session lifetime in seconds (refreshed on use). Default 7 days. */
  SESSION_TTL: Type.Number({ default: 60 * 60 * 24 * 7 }),
  /** Absolute session cap in seconds — a session can never outlive this. Default 30 days. */
  SESSION_ABS_TTL: Type.Number({ default: 60 * 60 * 24 * 30 }),
  /** Email-verification token lifetime in seconds. Default 24 hours. */
  EMAIL_VERIFICATION_TTL: Type.Number({ default: 60 * 60 * 24 }),
  /** Password-reset token lifetime in seconds. Default 1 hour. */
  PASSWORD_RESET_TTL: Type.Number({ default: 60 * 60 }),
  /** Base URL of the admin web app, used to build verify/reset links in emails. */
  APP_BASE_URL: Type.String({ default: "http://localhost:5174" }),
  /** From-address for outbound account emails. */
  EMAIL_FROM: Type.String({ default: "no-reply@proctoring.local" }),
  /** scrypt cost parameters. Lowered in the test env for speed (see vitest.config). */
  SCRYPT_N: Type.Number({ default: 16384 }),
  SCRYPT_R: Type.Number({ default: 8 }),
  SCRYPT_P: Type.Number({ default: 1 }),

  // --- Reporting (PRO-26) ---------------------------------------------------
  /**
   * Base URL of the isolated violation-ingest service. core-api reads the
   * violation timeline from it over HTTP when assembling a report — the two
   * services do not share a table (CLAUDE.md §5).
   */
  VIOLATION_INGEST_URL: Type.String({ default: "http://localhost:3002" }),
  /**
   * Service API key core-api presents to violation-ingest's read API. A
   * machine credential from the secrets store — never committed. Empty in
   * dev/test (the report route injects a stub client in tests).
   */
  VIOLATION_INGEST_API_KEY: Type.String({ default: "" }),

  // --- Evidence storage (PRO-27) --------------------------------------------
  /**
   * Name of the private S3 bucket holding proctoring evidence (the Terraform
   * `evidence` bucket). Empty in dev/test, where the route injects a stub store;
   * required in production for the S3-backed store to function.
   */
  EVIDENCE_BUCKET: Type.String({ default: "" }),
  /** AWS region of the evidence bucket. */
  AWS_REGION: Type.String({ default: "us-east-1" }),
  /**
   * Optional S3 endpoint override (e.g. MinIO/LocalStack for local dev). Empty
   * uses the real AWS endpoint. Credentials always come from the default AWS
   * provider chain (the ECS task role) — never from config (CLAUDE.md §6).
   */
  S3_ENDPOINT: Type.String({ default: "" }),
  /** Path-style addressing — needed by MinIO/LocalStack; off for real S3. */
  S3_FORCE_PATH_STYLE: Type.Boolean({ default: false }),
  /** Lifetime of a presigned upload URL, in seconds. Default 5 minutes. */
  EVIDENCE_UPLOAD_URL_TTL: Type.Number({ default: 300 }),
  /** Lifetime of a presigned retrieval URL, in seconds. Default 5 minutes. */
  EVIDENCE_GET_URL_TTL: Type.Number({ default: 300 }),
  /** Hard cap on a single snapshot's byte size (defends the upload grant). 10 MiB. */
  EVIDENCE_MAX_BYTES: Type.Number({ default: 10 * 1024 * 1024 }),
});

export type Config = Static<typeof ConfigSchema>;

const CONFIG_KEYS = Object.keys(ConfigSchema.properties) as Array<keyof Config>;

function loadConfig(): Config {
  // Pull only the keys we care about, dropping undefined so defaults apply.
  const raw: Record<string, string> = {};
  for (const key of CONFIG_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      raw[key] = value;
    }
  }

  // Apply defaults, then coerce string env values to their schema types.
  const candidate = Value.Convert(ConfigSchema, Value.Default(ConfigSchema, raw));

  if (!Value.Check(ConfigSchema, candidate)) {
    const errors = [...Value.Errors(ConfigSchema, candidate)]
      .map((e) => `  - ${e.path || "(root)"}: ${e.message}`)
      .join("\n");
    throw new Error(
      `Invalid core-api configuration. Check your environment / .env:\n${errors}`,
    );
  }

  return candidate;
}

export const config = loadConfig();
