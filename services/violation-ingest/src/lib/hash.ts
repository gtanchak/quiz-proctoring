import { createHash, timingSafeEqual } from "node:crypto";

/** SHA-256 hex. Matches how core-api hashes session tokens and API keys. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Indexed API-key lookup prefix length — must match core-api's KEY_PREFIX_LENGTH. */
export const API_KEY_PREFIX_LENGTH = 14;

export function apiKeyPrefix(token: string): string {
  return token.slice(0, API_KEY_PREFIX_LENGTH);
}

/** Constant-time comparison of two hex-encoded hashes. */
export function hexEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ab, bb);
}
