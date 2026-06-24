import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/client.js";
import {
  type EvidenceStore,
  setEvidenceStore,
} from "../src/lib/evidence-store.js";
import { setViolationsClient } from "../src/lib/violations-client.js";
import { createTestApp, type TestApp } from "./helpers/app.js";
import { type SeededKey, cleanupOrgs, seedOrgWithKey } from "./helpers/seed.js";

/** Minimal stubs so the report (violation log) + evidence (S3) routes resolve
 * without the external services — this suite only exercises tenant scoping. */
const stubStore: EvidenceStore = {
  keyFor: (attemptId, snapshotId) => `${attemptId}/${snapshotId}`,
  presignUpload: async (key) => ({ url: `https://s3.test/${key}`, headers: {} }),
  presignDownload: async (key) => `https://s3.test/${key}?get`,
  deleteObjects: async () => {},
};

/**
 * Tenant data isolation (PRO-57, FR-38). Proves the boundary holds across
 * *every* tenant-owned resource, not just tests: a second tenant must never be
 * able to read or mutate the first tenant's data — cross-tenant access returns
 * 404 (never 403), so existence never leaks across tenants.
 */
describe("tenant data isolation", () => {
  let app: TestApp;
  let a: SeededKey;
  let b: SeededKey;
  let testId: string;
  let attemptId: string;

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createTestApp();
    setViolationsClient({ async listForAttempt() { return []; } });
    setEvidenceStore(stubStore);
    a = await seedOrgWithKey("iso-tenant-a");
    b = await seedOrgWithKey("iso-tenant-b");

    // Tenant A builds a full resource graph: test → question → published → attempt.
    testId = (
      await app.inject({
        method: "POST",
        url: "/v1/tests",
        headers: auth(a.token),
        payload: { title: "A's test", durationMinutes: 30 },
      })
    ).json().id;

    await app.inject({
      method: "POST",
      url: `/v1/tests/${testId}/questions`,
      headers: auth(a.token),
      payload: {
        type: "mcq_single",
        prompt: "1 + 1 = ?",
        options: [
          { text: "2", correct: true },
          { text: "3", correct: false },
        ],
      },
    });
    await app.inject({
      method: "POST",
      url: `/v1/tests/${testId}/publish`,
      headers: auth(a.token),
    });
    attemptId = (
      await app.inject({
        method: "POST",
        url: `/v1/tests/${testId}/attempts`,
        headers: auth(a.token),
        payload: { candidateEmail: "candidate@example.com" },
      })
    ).json().id;
  });

  afterAll(async () => {
    await cleanupOrgs([a.orgId, b.orgId]);
    setViolationsClient(null);
    setEvidenceStore(null);
    await app.close();
    await pool.end();
  });

  it("tenant A can reach its own resources (positive control)", async () => {
    for (const url of [
      `/v1/tests/${testId}`,
      `/v1/tests/${testId}/questions`,
      `/v1/tests/${testId}/attempts`,
      `/v1/attempts/${attemptId}`,
      `/v1/attempts/${attemptId}/report`,
      `/v1/attempts/${attemptId}/evidence`,
      `/v1/tests/${testId}/invites`,
    ]) {
      const res = await app.inject({ method: "GET", url, headers: auth(a.token) });
      expect(res.statusCode, `A GET ${url}`).toBe(200);
    }
  });

  it("tenant B gets 404 (not 403) reading any of tenant A's resources", async () => {
    for (const url of [
      `/v1/tests/${testId}`,
      `/v1/tests/${testId}/questions`,
      `/v1/tests/${testId}/attempts`,
      `/v1/attempts/${attemptId}`,
      `/v1/attempts/${attemptId}/report`,
      `/v1/attempts/${attemptId}/evidence`,
      `/v1/tests/${testId}/invites`,
    ]) {
      const res = await app.inject({ method: "GET", url, headers: auth(b.token) });
      expect(res.statusCode, `B GET ${url}`).toBe(404);
      expect(res.json().error.code, `B GET ${url}`).toBe("NOT_FOUND");
    }
  });

  it("tenant B cannot mutate tenant A's resources (404, never leaking existence)", async () => {
    const mutations = [
      { method: "PATCH" as const, url: `/v1/tests/${testId}`, payload: { title: "hijack" } },
      { method: "DELETE" as const, url: `/v1/tests/${testId}` },
      { method: "POST" as const, url: `/v1/tests/${testId}/publish` },
      {
        method: "POST" as const,
        url: `/v1/tests/${testId}/questions`,
        payload: {
          type: "mcq_single",
          prompt: "x",
          options: [
            { text: "a", correct: true },
            { text: "b", correct: false },
          ],
        },
      },
      { method: "POST" as const, url: `/v1/attempts/${attemptId}/submit` },
      { method: "DELETE" as const, url: `/v1/attempts/${attemptId}/evidence` },
    ];
    for (const call of mutations) {
      const res = await app.inject({ ...call, headers: auth(b.token) });
      expect(res.statusCode, `B ${call.method} ${call.url}`).toBe(404);
    }
  });
});
