import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * API key format: `proct_<base64url-secret>`.
 *
 * We never store the raw key — only a SHA-256 hash plus a short, indexed prefix
 * used to look the row up before the (constant-time) hash comparison. The raw
 * key is shown to the admin exactly once at creation.
 */
const KEY_PREFIX_TAG = "proct_";
const SECRET_BYTES = 24;
/** Length of the indexed lookup prefix: the tag plus the first 8 secret chars. */
export const KEY_PREFIX_LENGTH = KEY_PREFIX_TAG.length + 8;

export interface GeneratedApiKey {
  /** The full secret. Shown once; never stored. */
  token: string;
  /** Indexed lookup prefix stored alongside the hash. */
  prefix: string;
  /** SHA-256 hex hash stored in the database. */
  hash: string;
}

export function hashApiKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function prefixOf(token: string): string {
  return token.slice(0, KEY_PREFIX_LENGTH);
}

export function generateApiKey(): GeneratedApiKey {
  const token = KEY_PREFIX_TAG + randomBytes(SECRET_BYTES).toString("base64url");
  return { token, prefix: prefixOf(token), hash: hashApiKey(token) };
}

/** Constant-time comparison of two hex-encoded hashes. */
export function hashesMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ab, bb);
}
