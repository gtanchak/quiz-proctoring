import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

/**
 * Password hashing with scrypt (Node core — no native build dependency, memory-
 * hard, sufficient for this platform's scale). The stored value is self-
 * describing — `scrypt$N$r$p$<saltB64>$<hashB64>` — so the cost parameters can
 * evolve without a migration: each hash carries the parameters it was made with.
 *
 * Raw passwords never leave this module's callers and are never logged.
 */
const KEY_LENGTH = 32;
const SALT_BYTES = 16;

/** scrypt needs ~128*N*r bytes of memory; give generous headroom. */
function maxmemFor(N: number, r: number): number {
  return 128 * N * r * 2 + 1024 * 1024;
}

export function hashPassword(plain: string): string {
  const { SCRYPT_N: N, SCRYPT_R: r, SCRYPT_P: p } = config;
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(plain, salt, KEY_LENGTH, { N, r, p, maxmem: maxmemFor(N, r) });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/**
 * Constant-time verification of a password against a stored hash. Returns false
 * (never throws) for malformed or unparseable stored values.
 */
export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  let actual: Buffer;
  try {
    actual = scryptSync(plain, salt, expected.length, {
      N,
      r,
      p,
      maxmem: maxmemFor(N, r),
    });
  } catch {
    return false;
  }
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}
