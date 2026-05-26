/**
 * @proctoring/shared — the cross-boundary contract for the platform.
 *
 * This package holds the violation event schema, API types, and validation
 * logic shared by the SDK, both web apps, and every backend service. Defining
 * these once here is what keeps client and server from drifting apart.
 *
 * NOTE: This is the PRO-46 skeleton. The actual violation event schema and
 * validation are defined in PRO-50 and will be added here. For now this file
 * exports only enough to prove the package is importable and type-checks from
 * both a frontend app and a backend service.
 */

/** Semantic version of the shared contract surface. */
export const SHARED_CONTRACT_VERSION = "0.0.0" as const;

/** Marker confirming the shared package resolved at runtime (used by stubs). */
export const sharedPackageName = "@proctoring/shared" as const;
