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
