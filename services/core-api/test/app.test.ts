import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

describe("core-api foundation", () => {
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
    const body = res.json();
    expect(body).toMatchObject({ status: "ok", service: "core-api" });
    expect(typeof body.uptime).toBe("number");
  });

  it("unknown routes return the standard NOT_FOUND error envelope", async () => {
    // Unversioned path so the not-found handler is reached without /v1 auth.
    const res = await app.inject({ method: "GET", url: "/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: expect.stringContaining("not found"),
      },
    });
  });

  it("generates an OpenAPI spec that includes /health", () => {
    const spec = app.swagger();
    expect(spec.openapi).toBeDefined();
    expect(spec.paths?.["/health"]).toBeDefined();
  });

  it("serves Swagger UI at /docs", async () => {
    const res = await app.inject({ method: "GET", url: "/docs/" });
    expect(res.statusCode).toBe(200);
  });
});
