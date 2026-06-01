import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque bearer tokens for sessions and one-time email links (PRO-39).
 *
 * Same pattern as API keys (lib/api-key.ts) and candidate session tokens
 * (lib/access.ts): we never store the raw token — only a SHA-256 hash plus a
 * short indexed prefix used to find the row before the constant-time hash
 * compare. The raw token is shown to the client exactly once.
 *
 * Each token carries a human-readable tag so the auth layer can route by
 * credential kind (`sess_…` → session lookup, `proct_…` → API key, etc.).
 */
const SECRET_BYTES = 24;

/** Length of the indexed lookup prefix stored alongside the hash. */
export const TOKEN_PREFIX_LENGTH = 16;

/** Tags identifying each token kind. The `proct_` API-key tag lives in lib/api-key.ts. */
export const TOKEN_TAGS = {
  session: "sess_",
  emailVerification: "verify_",
  passwordReset: "reset_",
} as const;

export interface GeneratedToken {
  /** The full secret. Shown once; never stored. */
  token: string;
  /** Indexed lookup prefix stored alongside the hash. */
  prefix: string;
  /** SHA-256 hex hash stored in the database. */
  hash: string;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenPrefix(token: string): string {
  return token.slice(0, TOKEN_PREFIX_LENGTH);
}

export function generateToken(tag: string): GeneratedToken {
  const token = tag + randomBytes(SECRET_BYTES).toString("base64url");
  return { token, prefix: tokenPrefix(token), hash: hashToken(token) };
}

/** Constant-time comparison of two hex-encoded hashes. */
export function tokenHashesMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ab, bb);
}
