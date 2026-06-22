import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { pool } from "../src/db/client.js";
import {
  type EvidenceStore,
  setEvidenceStore,
} from "../src/lib/evidence-store.js";
import { type SeededKey, cleanupOrgs, seedOrgWithKey } from "./helpers/seed.js";

/**
 * Fake object store (PRO-27): records calls and mints predictable URLs, so the
 * suite never touches AWS — the same injectable pattern as the violation log
 * client and the email sender.
 */
const deleted: string[] = [];
const fakeStore: EvidenceStore = {
  keyFor: (attemptId, snapshotId) =>
    `evidence/${attemptId}/snapshots/${snapshotId}`,
  presignUpload: async (key, contentType) => ({
    url: `https://s3.test/${key}?upload`,
    headers: { "Content-Type": contentType },
  }),
  presignDownload: async (key) => `https://s3.test/${key}?get`,
  deleteObjects: async (keys) => {
    deleted.push(...keys);
  },
};

function snapshotMeta(
  attemptId: string,
  id: string = crypto.randomUUID(),
  over: Record<string, unknown> = {},
) {
  return {
    schemaVersion: 1,
    id,
    attemptId,
    kind: "webcam",
    capturedAt: "2026-06-01T12:01:00.000Z",
    contentType: "image/jpeg",
    byteSize: 24_000,
    width: 640,
    height: 480,
    ...over,
  };
}

describe("evidence storage & viewer (PRO-27)", () => {
  let app: FastifyInstance;
  let owner: SeededKey;
  let other: SeededKey;

  const admin = (t: string) => ({ authorization: `Bearer ${t}` });

  /** Publishes a timed test and returns its share-link token. */
  async function publishedTest(): Promise<string> {
    const t = (
      await app.inject({
        method: "POST",
        url: "/v1/tests",
        headers: admin(owner.token),
        payload: { title: "Proctored", durationMinutes: 60 },
      })
    ).json();
    await app.inject({
      method: "POST",
      url: `/v1/tests/${t.id}/questions`,
      headers: admin(owner.token),
      payload: {
        type: "mcq_single",
        prompt: "Q",
        options: [
          { text: "a", correct: true },
          { text: "b", correct: false },
        ],
      },
    });
    await app.inject({
      method: "POST",
      url: `/v1/tests/${t.id}/publish`,
      headers: admin(owner.token),
    });
    return t.accessToken as string;
  }

  /** Starts an attempt via the share link; returns its id + candidate session token. */
  async function startAttempt(
    token: string,
  ): Promise<{ attemptId: string; sessionToken: string }> {
    const started = (
      await app.inject({
        method: "POST",
        url: `/v1/public/tests/${token}/start`,
        payload: { candidateEmail: "c@example.com" },
      })
    ).json();
    return {
      attemptId: started.attempt.id as string,
      sessionToken: started.sessionToken as string,
    };
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    setEvidenceStore(fakeStore);
    owner = await seedOrgWithKey("evidence-owner");
    other = await seedOrgWithKey("evidence-other");
  });

  afterAll(async () => {
    setEvidenceStore(null);
    await cleanupOrgs([owner.orgId, other.orgId]);
    await app.close();
    await pool.end();
  });

  beforeEach(() => {
    deleted.length = 0;
  });

  it("issues a presigned upload grant for a snapshot", async () => {
    const token = await publishedTest();
    const { attemptId, sessionToken } = await startAttempt(token);
    const snapId = crypto.randomUUID();

    const res = await app.inject({
      method: "POST",
      url: "/v1/public/attempt/snapshots",
      headers: admin(sessionToken),
      payload: snapshotMeta(attemptId, snapId),
    });

    expect(res.statusCode).toBe(201);
    const grant = res.json();
    expect(grant.snapshotId).toBe(snapId);
    expect(grant.method).toBe("PUT");
    expect(grant.url).toContain(`evidence/${attemptId}/snapshots/${snapId}`);
    expect(grant.headers["Content-Type"]).toBe("image/jpeg");
    expect(typeof grant.expiresAt).toBe("string");
  });

  it("is idempotent for a retried snapshot id, and lists it for the admin", async () => {
    const token = await publishedTest();
    const { attemptId, sessionToken } = await startAttempt(token);
    const snapId = crypto.randomUUID();

    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/public/attempt/snapshots",
        headers: admin(sessionToken),
        payload: snapshotMeta(attemptId, snapId),
      });
      expect(res.statusCode).toBe(201);
    }

    const list = await app.inject({
      method: "GET",
      url: `/v1/attempts/${attemptId}/evidence`,
      headers: admin(owner.token),
    });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.attemptId).toBe(attemptId);
    expect(body.items).toHaveLength(1); // retry did not duplicate the row
    expect(body.items[0]).toMatchObject({
      id: snapId,
      kind: "webcam",
      contentType: "image/jpeg",
      width: 640,
      height: 480,
    });
    expect(body.items[0].url).toContain("?get");
  });

  it("rejects a snapshot larger than the cap", async () => {
    const token = await publishedTest();
    const { attemptId, sessionToken } = await startAttempt(token);

    const res = await app.inject({
      method: "POST",
      url: "/v1/public/attempt/snapshots",
      headers: admin(sessionToken),
      payload: snapshotMeta(attemptId, crypto.randomUUID(), {
        byteSize: 50 * 1024 * 1024,
      }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an upload without a session token", async () => {
    const token = await publishedTest();
    const { attemptId } = await startAttempt(token);

    const res = await app.inject({
      method: "POST",
      url: "/v1/public/attempt/snapshots",
      payload: snapshotMeta(attemptId),
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an upload once the attempt is finalized", async () => {
    const token = await publishedTest();
    const { attemptId, sessionToken } = await startAttempt(token);

    await app.inject({
      method: "POST",
      url: "/v1/public/attempt/submit",
      headers: admin(sessionToken),
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/public/attempt/snapshots",
      headers: admin(sessionToken),
      payload: snapshotMeta(attemptId),
    });
    expect(res.statusCode).toBe(409);
  });

  it("does not leak another org's evidence (404)", async () => {
    const token = await publishedTest();
    const { attemptId, sessionToken } = await startAttempt(token);
    await app.inject({
      method: "POST",
      url: "/v1/public/attempt/snapshots",
      headers: admin(sessionToken),
      payload: snapshotMeta(attemptId),
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/attempts/${attemptId}/evidence`,
      headers: admin(other.token),
    });
    expect(res.statusCode).toBe(404);
  });

  it("permanently deletes an attempt's evidence (bytes + rows)", async () => {
    const token = await publishedTest();
    const { attemptId, sessionToken } = await startAttempt(token);
    const snapId = crypto.randomUUID();
    await app.inject({
      method: "POST",
      url: "/v1/public/attempt/snapshots",
      headers: admin(sessionToken),
      payload: snapshotMeta(attemptId, snapId),
    });

    const del = await app.inject({
      method: "DELETE",
      url: `/v1/attempts/${attemptId}/evidence`,
      headers: admin(owner.token),
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ deleted: 1 });
    expect(deleted).toContain(`evidence/${attemptId}/snapshots/${snapId}`);

    const list = await app.inject({
      method: "GET",
      url: `/v1/attempts/${attemptId}/evidence`,
      headers: admin(owner.token),
    });
    expect(list.json().items).toHaveLength(0);
  });
});
