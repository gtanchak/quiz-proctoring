import {
  type AttemptEvidence,
  type AttemptReport,
  validateAttemptEvidence,
  validateAttemptReport,
} from "@proctoring/shared";

/**
 * Thin core-api client for admin-web. Kept deliberately small — a proper
 * client + auth/session handling lands with the admin dashboard (PRO-30). For
 * now it reads the session token from storage and validates responses against
 * the shared contract before handing them to the UI.
 */

const env = (import.meta as { env?: Record<string, string | undefined> }).env;
const API_BASE = env?.VITE_CORE_API_URL ?? "http://localhost:3001";
const TOKEN_KEY = "admin_session_token";

export function getSessionToken(): string | null {
  return typeof localStorage !== "undefined"
    ? localStorage.getItem(TOKEN_KEY)
    : null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions {
  fetchImpl?: typeof fetch;
  token?: string | null;
}

/** Fetches the per-attempt report (PRO-26). Throws {@link ApiError} on failure. */
export async function getAttemptReport(
  attemptId: string,
  options: RequestOptions = {},
): Promise<AttemptReport> {
  const doFetch = options.fetchImpl ?? fetch;
  const token = options.token ?? getSessionToken();

  const res = await doFetch(
    `${API_BASE}/v1/attempts/${attemptId}/report`,
    token ? { headers: { authorization: `Bearer ${token}` } } : undefined,
  );

  if (!res.ok) {
    throw new ApiError(res.status, await errorMessage(res));
  }

  const result = validateAttemptReport(await res.json());
  if (!result.valid) {
    throw new ApiError(res.status, "The report response was malformed");
  }
  return result.value;
}

/** Fetches an attempt's evidence with signed URLs (PRO-27). Throws {@link ApiError}. */
export async function getAttemptEvidence(
  attemptId: string,
  options: RequestOptions = {},
): Promise<AttemptEvidence> {
  const doFetch = options.fetchImpl ?? fetch;
  const token = options.token ?? getSessionToken();

  const res = await doFetch(
    `${API_BASE}/v1/attempts/${attemptId}/evidence`,
    token ? { headers: { authorization: `Bearer ${token}` } } : undefined,
  );

  if (!res.ok) {
    throw new ApiError(res.status, await errorMessage(res));
  }

  const result = validateAttemptEvidence(await res.json());
  if (!result.valid) {
    throw new ApiError(res.status, "The evidence response was malformed");
  }
  return result.value;
}

/**
 * Permanently deletes all of an attempt's evidence (PRO-27). Returns the number
 * of items erased. Throws {@link ApiError} on failure.
 */
export async function deleteAttemptEvidence(
  attemptId: string,
  options: RequestOptions = {},
): Promise<number> {
  const doFetch = options.fetchImpl ?? fetch;
  const token = options.token ?? getSessionToken();

  const res = await doFetch(`${API_BASE}/v1/attempts/${attemptId}/evidence`, {
    method: "DELETE",
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });

  if (!res.ok) {
    throw new ApiError(res.status, await errorMessage(res));
  }
  const body = (await res.json()) as { deleted?: number };
  return body.deleted ?? 0;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    // fall through to a generic message
  }
  if (res.status === 401) return "You need to sign in to view this report.";
  if (res.status === 404) return "Report not found, or you don't have access.";
  return `Request failed (${res.status}).`;
}
