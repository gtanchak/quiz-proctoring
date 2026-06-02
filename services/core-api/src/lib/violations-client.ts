import { config } from "../config.js";
import { AppError } from "./errors.js";

/**
 * Reads the violation timeline for an attempt from the **isolated**
 * violation-ingest service (PRO-25), over HTTP.
 *
 * core-api owns attempts/tests/score; the violation log lives in a separate
 * service so a spike in violation traffic can't slow the dashboard (CLAUDE.md
 * §5). For the per-attempt report (PRO-26), core-api acts as a BFF: it
 * owner-scopes the attempt from its own store, then fetches the timeline here.
 * Reading over HTTP (not a shared table) keeps that isolation intact.
 */

/** One stored violation as returned by violation-ingest's read API. */
export interface IngestedViolation {
  id: string;
  attemptId: string;
  type: string;
  severity: string;
  schemaVersion: number;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  evidenceIds: string[];
  metadata: Record<string, unknown> | null;
  receivedAt: string;
}

export interface ViolationsClient {
  /** All violations for an attempt, ascending by start time. */
  listForAttempt(attemptId: string): Promise<IngestedViolation[]>;
}

/** Page size for the ingest read API (its documented maximum). */
const PAGE_SIZE = 1000;

/** Talks to violation-ingest's `GET /violations`. `fetchImpl` is injectable for tests. */
export class HttpViolationsClient implements ViolationsClient {
  constructor(
    private readonly opts: {
      baseUrl: string;
      apiKey: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async listForAttempt(attemptId: string): Promise<IngestedViolation[]> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const all: IngestedViolation[] = [];
    let offset = 0;

    // Page until a short page comes back, so reports never silently truncate.
    for (;;) {
      const url = new URL("/violations", this.opts.baseUrl);
      url.searchParams.set("attemptId", attemptId);
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("offset", String(offset));

      let res: Response;
      try {
        res = await doFetch(url.toString(), {
          headers: { authorization: `Bearer ${this.opts.apiKey}` },
        });
      } catch (cause) {
        throw AppError.badGateway(
          "Could not reach the violation log service",
          { cause: String(cause) },
        );
      }
      if (!res.ok) {
        throw AppError.badGateway(
          "The violation log service returned an error",
          { status: res.status },
        );
      }
      const body = (await res.json()) as { data: IngestedViolation[] };
      all.push(...body.data);
      if (body.data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return all;
  }
}

/**
 * Process-wide override (defaults to the HTTP client built from config). Tests
 * install a stub via `setViolationsClient` so they need no live ingest service —
 * the same pattern as the email sender (see lib/email.ts).
 */
let overrideClient: ViolationsClient | null = null;

export function setViolationsClient(client: ViolationsClient | null): void {
  overrideClient = client;
}

export function getViolationsClient(): ViolationsClient {
  return (
    overrideClient ??
    new HttpViolationsClient({
      baseUrl: config.VIOLATION_INGEST_URL,
      apiKey: config.VIOLATION_INGEST_API_KEY,
    })
  );
}
