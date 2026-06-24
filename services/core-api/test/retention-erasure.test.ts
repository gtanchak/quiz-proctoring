import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client.js";
import { attempts, evidence } from "../src/db/schema/tests.js";
import {
  type EvidenceStore,
  setEvidenceStore,
} from "../src/lib/evidence-store.js";
import { createTestApp, type TestApp } from "./helpers/app.js";
import { type SeededKey, cleanupOrgs, seedOrgWithKey } from "./helpers/seed.js";

const CANDIDATE = "erase-me@test.example";

/**
 * Data retention policy + permanent erasure (PRO-57, FR-41; CLAUDE.md §6).
 */
describe("tenant retention & candidate erasure (/v1/org)", () => {
  let app: TestApp;
  let tenant: SeededKey;
  const deletedKeys: string[] = [];

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  const stubStore: EvidenceStore = {
    keyFor: (attemptId, snapshotId) => `${attemptId}/${snapshotId}`,
    presignUpload: async (key) => ({ url: `https://s3.test/${key}`, headers: {} }),
    presignDownload: async (key) => `https://s3.test/${key}?get`,
    deleteObjects: async (keys) => {
      deletedKeys.push(...keys);
    },
  };

  beforeAll(async () => {
    app = await createTestApp();
    setEvidenceStore(stubStore);
    tenant = await seedOrgWithKey("retention");
  });

  afterAll(async () => {
    setEvidenceStore(null);
    await cleanupOrgs([tenant.orgId]);
    await app.close();
    await pool.end();
  });

  describe("retention policy", () => {
    it("defaults to null and can be set, read back, and cleared", async () => {
      const initial = await app.inject({
        method: "GET",
        url: "/v1/org/retention",
        headers: auth(tenant.token),
      });
      expect(initial.json()).toEqual({ retentionDays: null });

      const set = await app.inject({
        method: "PATCH",
        url: "/v1/org/retention",
        headers: auth(tenant.token),
        payload: { retentionDays: 90 },
      });
      expect(set.statusCode).toBe(200);
      expect(set.json()).toEqual({ retentionDays: 90 });

      const cleared = await app.inject({
        method: "PATCH",
        url: "/v1/org/retention",
        headers: auth(tenant.token),
        payload: { retentionDays: null },
      });
      expect(cleared.json()).toEqual({ retentionDays: null });
    });

    it("rejects an out-of-range retention (400)", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/v1/org/retention",
        headers: auth(tenant.token),
        payload: { retentionDays: 0 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION");
    });
  });

  describe("candidate erasure", () => {
    let attemptId: string;

    beforeAll(async () => {
      const testId = (
        await app.inject({
          method: "POST",
          url: "/v1/tests",
          headers: auth(tenant.token),
          payload: { title: "Erase test" },
        })
      ).json().id;
      await app.inject({
        method: "POST",
        url: `/v1/tests/${testId}/questions`,
        headers: auth(tenant.token),
        payload: {
          type: "mcq_single",
          prompt: "q",
          options: [
            { text: "a", correct: true },
            { text: "b", correct: false },
          ],
        },
      });
      await app.inject({
        method: "POST",
        url: `/v1/tests/${testId}/publish`,
        headers: auth(tenant.token),
      });
      attemptId = (
        await app.inject({
          method: "POST",
          url: `/v1/tests/${testId}/attempts`,
          headers: auth(tenant.token),
          payload: { candidateEmail: CANDIDATE },
        })
      ).json().id;
      // An evidence row whose bytes must be erased from storage.
      await db.insert(evidence).values({
        id: randomUUID(),
        attemptId,
        kind: "webcam",
        contentType: "image/jpeg",
        byteSize: 1024,
        capturedAt: new Date(),
        storageKey: `${attemptId}/snap-1`,
      });
    });

    it("permanently erases the candidate's attempts + evidence bytes", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/org/candidates/erase",
        headers: auth(tenant.token),
        payload: { candidateEmail: CANDIDATE },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        attemptsDeleted: 1,
        evidenceDeleted: 1,
      });

      // The S3 bytes were deleted first...
      expect(deletedKeys).toContain(`${attemptId}/snap-1`);
      // ...and the attempt (cascading evidence/responses rows) is gone.
      const remaining = await db
        .select({ id: attempts.id })
        .from(attempts)
        .where(eq(attempts.id, attemptId));
      expect(remaining).toHaveLength(0);
      const evRows = await db
        .select({ id: evidence.id })
        .from(evidence)
        .where(eq(evidence.attemptId, attemptId));
      expect(evRows).toHaveLength(0);
    });
  });
});
