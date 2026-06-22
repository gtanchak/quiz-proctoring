import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  deleteAttemptEvidence,
  getAttemptEvidence,
  getAttemptReport,
} from "../src/api/client.js";
import { sampleEvidence, sampleReport } from "./fixtures.js";

const ATTEMPT = "22222222-2222-2222-2222-222222222222";

const jsonResponse = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe("getAttemptReport", () => {
  it("requests the report with a bearer token and validates the payload", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, sampleReport()));

    const report = await getAttemptReport(ATTEMPT, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      token: "sess_abc",
    });

    expect(report.test.title).toBe("Algebra I");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain(`/v1/attempts/${ATTEMPT}/report`);
    expect((init as RequestInit).headers).toMatchObject({
      authorization: "Bearer sess_abc",
    });
  });

  it("throws ApiError with the server message on a non-2xx", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(404, { error: { code: "NOT_FOUND", message: "Attempt not found" } }),
    );

    await expect(
      getAttemptReport(ATTEMPT, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        token: "t",
      }),
    ).rejects.toMatchObject({ status: 404, message: "Attempt not found" });
  });

  it("rejects a malformed report payload", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { nope: true }));

    await expect(
      getAttemptReport(ATTEMPT, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        token: "t",
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe("getAttemptEvidence", () => {
  it("fetches and validates the attempt's evidence", async () => {
    const payload = { attemptId: ATTEMPT, items: sampleEvidence() };
    const fetchImpl = vi.fn(async () => jsonResponse(200, payload));

    const result = await getAttemptEvidence(ATTEMPT, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      token: "sess_abc",
    });

    expect(result.items).toHaveLength(2);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain(`/v1/attempts/${ATTEMPT}/evidence`);
    expect((init as RequestInit).headers).toMatchObject({
      authorization: "Bearer sess_abc",
    });
  });

  it("rejects a malformed evidence payload", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { nope: true }));

    await expect(
      getAttemptEvidence(ATTEMPT, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        token: "t",
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe("deleteAttemptEvidence", () => {
  it("sends a DELETE and returns the count erased", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { deleted: 3 }));

    const deleted = await deleteAttemptEvidence(ATTEMPT, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      token: "sess_abc",
    });

    expect(deleted).toBe(3);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain(`/v1/attempts/${ATTEMPT}/evidence`);
    expect((init as RequestInit).method).toBe("DELETE");
  });

  it("throws ApiError on a non-2xx", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(403, { error: { code: "FORBIDDEN", message: "no" } }),
    );

    await expect(
      deleteAttemptEvidence(ATTEMPT, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        token: "t",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
