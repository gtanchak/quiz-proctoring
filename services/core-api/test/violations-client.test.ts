import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/lib/errors.js";
import {
  HttpViolationsClient,
  type IngestedViolation,
} from "../src/lib/violations-client.js";

const ATTEMPT = "22222222-2222-2222-2222-222222222222";

function row(id: number): IngestedViolation {
  return {
    id: `${id}`,
    attemptId: ATTEMPT,
    type: "tab_switch",
    severity: "low",
    schemaVersion: 1,
    startedAt: "2026-06-01T12:00:00.000Z",
    endedAt: null,
    durationMs: null,
    evidenceIds: [],
    metadata: null,
    receivedAt: "2026-06-01T12:00:01.000Z",
  };
}

const ok = (data: IngestedViolation[]): Response =>
  ({ ok: true, json: async () => ({ data }) }) as Response;

describe("HttpViolationsClient", () => {
  it("sends the attempt id and a bearer key, returning the page", async () => {
    const fetchImpl = vi.fn(async () => ok([row(1), row(2)]));
    const client = new HttpViolationsClient({
      baseUrl: "http://ingest.local",
      apiKey: "proct_secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.listForAttempt(ATTEMPT);

    expect(result).toHaveLength(2);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain(`attemptId=${ATTEMPT}`);
    expect((init as RequestInit).headers).toMatchObject({
      authorization: "Bearer proct_secret",
    });
  });

  it("pages until a short page is returned", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => row(i));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok(fullPage))
      .mockResolvedValueOnce(ok([row(1000)]));
    const client = new HttpViolationsClient({
      baseUrl: "http://ingest.local",
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.listForAttempt(ATTEMPT);

    expect(result).toHaveLength(1001);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toContain("offset=1000");
  });

  it("throws 502 when the upstream responds non-OK", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    const client = new HttpViolationsClient({
      baseUrl: "http://ingest.local",
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.listForAttempt(ATTEMPT)).rejects.toMatchObject({
      statusCode: 502,
    });
    await expect(client.listForAttempt(ATTEMPT)).rejects.toBeInstanceOf(AppError);
  });

  it("throws 502 when the upstream is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const client = new HttpViolationsClient({
      baseUrl: "http://ingest.local",
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.listForAttempt(ATTEMPT)).rejects.toMatchObject({
      statusCode: 502,
    });
  });
});
