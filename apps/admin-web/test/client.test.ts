import { describe, expect, it, vi } from "vitest";
import { ApiError, getAttemptReport } from "../src/api/client.js";
import { sampleReport } from "./fixtures.js";

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
