import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { VIOLATION_SCHEMA_VERSION } from "@proctoring/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { db, pool } from "../src/db/client.js";
import { apiKeys, attempts } from "../src/db/schema/external.js";
import { violations } from "../src/db/schema/violations.js";
import { apiKeyPrefix, sha256Hex } from "../src/lib/hash.js";

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

/** Seeds an attempt row and returns its id + raw session token. */
async function seedAttempt(): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  const token = randomUUID();
  await db
    .insert(attempts)
    .values({ id, status: "in_progress", sessionTokenHash: sha256Hex(token) });
  return { id, token };
}

/** Seeds an admin API key (the read API credential) and returns it. */
async function seedApiKey(): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  const token = `proct_${randomUUID()}`;
  await db.insert(apiKeys).values({
    id,
    name: "reporting-reader",
    keyPrefix: apiKeyPrefix(token),
    keyHash: sha256Hex(token),
  });
  return { id, token };
}

describe("violation ingest + read API", () => {
  let app: FastifyInstance;
  let attempt: { id: string; token: string };
  let orderAttempt: { id: string; token: string };
  let admin: { id: string; token: string };

  /** A valid event for `attempt`, with overrides for the field under test. */
  function event(overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: VIOLATION_SCHEMA_VERSION,
      id: randomUUID(),
      attemptId: attempt.id,
      type: "tab_switch",
      severity: "medium",
      startedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    attempt = await seedAttempt();
    orderAttempt = await seedAttempt();
    admin = await seedApiKey();
  });

  afterAll(async () => {
    await db
      .delete(violations)
      .where(inArray(violations.attemptId, [attempt.id, orderAttempt.id]));
    await db
      .delete(attempts)
      .where(inArray(attempts.id, [attempt.id, orderAttempt.id]));
    await db.delete(apiKeys).where(eq(apiKeys.id, admin.id));
    await app.close();
    await pool.end();
  });

  describe("POST /v1/violations", () => {
    it("rejects a request with no session token (401)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/violations",
        payload: { attemptId: attempt.id, events: [event()] },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("UNAUTHORIZED");
    });

    it("rejects an unknown session token (401)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/violations",
        headers: auth(randomUUID()),
        payload: { attemptId: attempt.id, events: [event()] },
      });
      expect(res.statusCode).toBe(401);
    });

    it("accepts a valid batch and persists it", async () => {
      const events = [event(), event({ type: "fullscreen_exit" })];
      const res = await app.inject({
        method: "POST",
        url: "/v1/violations",
        headers: auth(attempt.token),
        payload: { attemptId: attempt.id, events },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ accepted: 2, stored: 2, duplicates: 0 });

      const stored = await db
        .select()
        .from(violations)
        .where(eq(violations.id, events[0].id));
      expect(stored).toHaveLength(1);
      expect(stored[0].type).toBe("tab_switch");
      // Server stamps an authoritative receipt time.
      expect(stored[0].receivedAt).toBeInstanceOf(Date);
    });

    it("is idempotent: re-posting the same event ids stores nothing new", async () => {
      const e = event();
      const payload = { attemptId: attempt.id, events: [e] };
      const first = await app.inject({
        method: "POST",
        url: "/v1/violations",
        headers: auth(attempt.token),
        payload,
      });
      expect(first.json()).toEqual({ accepted: 1, stored: 1, duplicates: 0 });

      // Simulates a client retry after a brief disconnect.
      const retry = await app.inject({
        method: "POST",
        url: "/v1/violations",
        headers: auth(attempt.token),
        payload,
      });
      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toEqual({ accepted: 1, stored: 0, duplicates: 1 });
    });

    it("defaults an omitted schemaVersion (versioned schema)", async () => {
      const e = event();
      delete (e as Record<string, unknown>).schemaVersion;
      const res = await app.inject({
        method: "POST",
        url: "/v1/violations",
        headers: auth(attempt.token),
        payload: { attemptId: attempt.id, events: [e] },
      });
      expect(res.statusCode).toBe(200);
      const [stored] = await db
        .select()
        .from(violations)
        .where(eq(violations.id, e.id));
      expect(stored.schemaVersion).toBe(VIOLATION_SCHEMA_VERSION);
    });

    it("rejects a batch whose attemptId is not the authenticated attempt (400)", async () => {
      const otherId = randomUUID();
      const res = await app.inject({
        method: "POST",
        url: "/v1/violations",
        headers: auth(attempt.token),
        payload: { attemptId: otherId, events: [event({ attemptId: otherId })] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("BAD_REQUEST");
    });

    it("rejects an invalid event (unknown type) with a VALIDATION error", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/violations",
        headers: auth(attempt.token),
        payload: { attemptId: attempt.id, events: [event({ type: "not_a_type" })] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION");
    });

    it("rejects an empty batch (400)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/violations",
        headers: auth(attempt.token),
        payload: { attemptId: attempt.id, events: [] },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/violations", () => {
    it("requires an admin API key, not an attempt session token (401)", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/violations?attemptId=${orderAttempt.id}`,
        headers: auth(orderAttempt.token),
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns an attempt's events in chronological order", async () => {
      const base = Date.now();
      // Post out of chronological order; the API must sort by startedAt.
      const events = [
        { offset: 2000 },
        { offset: 0 },
        { offset: 1000 },
      ].map(({ offset }) => ({
        schemaVersion: VIOLATION_SCHEMA_VERSION,
        id: randomUUID(),
        attemptId: orderAttempt.id,
        type: "window_blur",
        severity: "low",
        startedAt: new Date(base + offset).toISOString(),
      }));
      const post = await app.inject({
        method: "POST",
        url: "/v1/violations",
        headers: auth(orderAttempt.token),
        payload: { attemptId: orderAttempt.id, events },
      });
      expect(post.statusCode).toBe(200);

      const res = await app.inject({
        method: "GET",
        url: `/v1/violations?attemptId=${orderAttempt.id}`,
        headers: auth(admin.token),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const times = body.data.map((r: { startedAt: string }) =>
        new Date(r.startedAt).getTime(),
      );
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(times[0]).toBe(base);
    });

    it("honours limit/offset pagination", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/violations?attemptId=${orderAttempt.id}&limit=1&offset=1`,
        headers: auth(admin.token),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(1);
      expect(body.pagination).toEqual({ limit: 1, offset: 1 });
    });
  });
});
