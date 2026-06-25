/**
 * @proctoring/shared — the cross-boundary contract for the platform.
 *
 * This package holds the violation event schema, API types, and validation
 * logic shared by the SDK, both web apps, and every backend service. Defining
 * these once here is what keeps client and server from drifting apart.
 */

/** Semantic version of the shared contract surface. */
export const SHARED_CONTRACT_VERSION = "0.8.0" as const;

/** Marker confirming the shared package resolved at runtime (used by stubs). */
export const sharedPackageName = "@proctoring/shared" as const;

// The violation event schema, types, and validation (PRO-50).
export * from "./violation/index.js";

// Authentication & accounts contract: roles, DTOs, auth request/response (PRO-39).
export * from "./auth/index.js";

// Proctoring requirements: which signals a test requires pre-start (PRO-14).
export * from "./proctoring/index.js";

// Evidence capture contract: snapshot config + per-image metadata (PRO-15).
export * from "./evidence/index.js";

// Per-attempt report contract: summary + violation timeline (PRO-26).
export * from "./report/index.js";

// Candidate session lifecycle: phases, transitions, progress (PRO-59).
export * from "./session/index.js";

// Pluggable scoring framework: ScoreResult, competency aggregation, bands (PRO-60).
export * from "./scoring/index.js";
