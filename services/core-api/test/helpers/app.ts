import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createApp } from "../../src/app.factory.js";

export interface InjectOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  payload?: unknown;
}

export interface InjectResponse {
  statusCode: number;
  headers: Record<string, string>;
  payload: string;
  body: string;
  // Mirrors Fastify's `res.json()` — returns the parsed body (typed loosely,
  // exactly like Fastify inject, so existing assertions keep working).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json(): any;
}

/**
 * Thin adapter so the existing test suites — written against Fastify's
 * `app.inject()` — drive the migrated NestJS app over supertest with no
 * per-call rewrites. `createTestApp()` returns an object exposing `inject()`
 * and `close()`, plus the raw Nest app as `nest` for the OpenAPI test.
 */
export interface TestApp {
  nest: INestApplication;
  inject(opts: InjectOptions): Promise<InjectResponse>;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const app = await createApp();
  await app.init();
  const server = app.getHttpServer();

  return {
    nest: app,
    async inject({ method, url, headers, payload }): Promise<InjectResponse> {
      const verb = method.toLowerCase() as
        | "get"
        | "post"
        | "put"
        | "patch"
        | "delete";
      let req = request(server)[verb](url);
      if (headers) {
        req = req.set(headers);
      }
      if (payload !== undefined) {
        req = req.send(payload as object);
      }
      const res = await req;
      return {
        statusCode: res.status,
        headers: res.headers as Record<string, string>,
        payload: res.text,
        body: res.text,
        json: () => res.body,
      };
    },
    async close(): Promise<void> {
      await app.close();
    },
  };
}
