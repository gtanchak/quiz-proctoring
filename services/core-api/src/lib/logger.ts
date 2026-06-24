import { Logger } from "@nestjs/common";

/**
 * Minimal structural logger used by framework-agnostic libs (email, audit) so
 * they don't depend on a specific HTTP framework's logger. Matches the
 * `(obj, msg)` call shape those libs use.
 */
export interface LoggerLike {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

const nest = new Logger("core-api");

/** Default logger backed by the NestJS logger. */
export const defaultLogger: LoggerLike = {
  info: (obj, msg) => nest.log(msg ?? "", obj),
  warn: (obj, msg) => nest.warn(msg ?? "", obj),
  error: (obj, msg) => nest.error(msg ?? "", obj),
};
