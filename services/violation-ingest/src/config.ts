import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/**
 * Typed, validated runtime configuration. Shares the Postgres instance with
 * core-api (this service reads `attempts`/`api_keys` for auth and owns the
 * `violations` table); it is a separate *deployable* with its own scaling.
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
  PORT: Type.Number({ default: 3002 }),
  LOG_LEVEL: Type.String({ default: "info" }),
  DATABASE_URL: Type.String({ minLength: 1 }),
  /** Max ingest requests per window, per attempt (or IP). Backpressure guard. */
  RATE_LIMIT_MAX: Type.Number({ default: 600 }),
  /** Rate-limit window in milliseconds (NestJS throttler `ttl`). */
  RATE_LIMIT_TTL_MS: Type.Number({ default: 60_000 }),
});

export type Config = Static<typeof ConfigSchema>;

const CONFIG_KEYS = Object.keys(ConfigSchema.properties) as Array<keyof Config>;

function loadConfig(): Config {
  const raw: Record<string, string> = {};
  for (const key of CONFIG_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      raw[key] = value;
    }
  }
  const candidate = Value.Convert(ConfigSchema, Value.Default(ConfigSchema, raw));
  if (!Value.Check(ConfigSchema, candidate)) {
    const errors = [...Value.Errors(ConfigSchema, candidate)]
      .map((e) => `  - ${e.path || "(root)"}: ${e.message}`)
      .join("\n");
    throw new Error(
      `Invalid violation-ingest configuration. Check your environment / .env:\n${errors}`,
    );
  }
  return candidate;
}

export const config = loadConfig();
