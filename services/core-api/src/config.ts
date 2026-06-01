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
