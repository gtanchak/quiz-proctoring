import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("violation-ingest foundation", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns ok without touching the database", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", service: "violation-ingest" });
  });

  it("unknown routes return the standard NOT_FOUND error envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: expect.stringContaining("not found"),
      },
    });
  });

  it("guards the ingest hot path with rate-limit headers", async () => {
    // The backpressure guard runs as an onRequest hook, so the headers are
    // present even on the unauthenticated rejection (before the DB is touched).
    const res = await app.inject({ method: "POST", url: "/v1/violations" });
    expect(res.statusCode).toBe(401);
    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
  });
});
