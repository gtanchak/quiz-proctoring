import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.factory.js";

describe("violation-ingest foundation", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns ok without touching the database", async () => {
    const res = await request(app.getHttpServer()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", service: "violation-ingest" });
  });

  it("unknown routes return the standard NOT_FOUND error envelope", async () => {
    const res = await request(app.getHttpServer()).get("/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: expect.stringContaining("not found"),
      },
    });
  });

  it("guards the ingest hot path with rate-limit headers", async () => {
    // The backpressure guard runs ahead of the handler, so the headers are
    // present even on the unauthenticated rejection (before the DB is touched).
    const res = await request(app.getHttpServer()).post("/v1/violations");
    expect(res.status).toBe(401);
    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
  });
});
