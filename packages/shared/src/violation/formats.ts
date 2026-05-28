import { FormatRegistry } from "@sinclair/typebox";

/**
 * Registers the string formats our schemas use so TypeBox's `Value` validators
 * enforce them. Standalone TypeBox (unlike Ajv in the Fastify services) does not
 * validate `format` unless the format is registered — without this, `Value.Check`
 * rejects every value carrying an unregistered format. Imported for side effects
 * by the validation module.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!FormatRegistry.Has("uuid")) {
  FormatRegistry.Set(
    "uuid",
    (value) => typeof value === "string" && UUID.test(value),
  );
}

if (!FormatRegistry.Has("date-time")) {
  FormatRegistry.Set(
    "date-time",
    (value) => typeof value === "string" && !Number.isNaN(Date.parse(value)),
  );
}
