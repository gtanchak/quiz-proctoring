import { createHash, randomBytes } from "node:crypto";

/**
 * Candidate access for shareable test links (PRO-8): the link's open/closed
 * state derived from the test, and the per-attempt candidate session token.
 */

export type LinkState = "not_yet_open" | "open" | "closed";

/**
 * Whether a test's share link currently admits candidates. A link is only
 * `open` when the test is published and within its availability window;
 * before/after the window it is `not_yet_open`/`closed`, and an unpublished
 * test is always `closed`.
 */
export function linkState(
  test: {
    status: "draft" | "published" | "archived";
    availableFrom: Date | null;
    availableUntil: Date | null;
  },
  now: Date = new Date(),
): LinkState {
  if (test.status !== "published") {
    return "closed";
  }
  if (test.availableFrom && now.getTime() < test.availableFrom.getTime()) {
    return "not_yet_open";
  }
  if (test.availableUntil && now.getTime() > test.availableUntil.getTime()) {
    return "closed";
  }
  return "open";
}

const SESSION_TOKEN_TAG = "ats_";
const SESSION_SECRET_BYTES = 24;

export interface GeneratedSessionToken {
  /** Raw token, returned to the candidate once. */
  token: string;
  /** SHA-256 hex hash stored on the attempt. */
  hash: string;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken(): GeneratedSessionToken {
  const token =
    SESSION_TOKEN_TAG + randomBytes(SESSION_SECRET_BYTES).toString("base64url");
  return { token, hash: hashSessionToken(token) };
}
