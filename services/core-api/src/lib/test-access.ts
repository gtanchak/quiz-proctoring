import { and, count, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { attempts, tests, type TestRow } from "../db/schema/tests.js";
import { AppError } from "./errors.js";

/**
 * Loads a test owned by the given API key, or throws 404. Shared by the tests
 * and questions routes so tenant scoping is enforced one way everywhere
 * (missing vs unowned both surface as 404 — never leak existence).
 */
export async function findOwnedTest(
  id: string,
  ownerKeyId: string,
): Promise<TestRow> {
  const [row] = await db
    .select()
    .from(tests)
    .where(and(eq(tests.id, id), eq(tests.ownerKeyId, ownerKeyId)))
    .limit(1);
  if (!row) {
    throw AppError.notFound("Test not found");
  }
  return row;
}

/**
 * Guards structural mutation of a test (its config or its questions): a
 * published test with attempts in progress is immutable, so candidates mid-test
 * never see it change underneath them.
 */
export async function assertTestMutable(test: TestRow): Promise<void> {
  if (test.status !== "published") {
    return;
  }
  const [{ total }] = await db
    .select({ total: count() })
    .from(attempts)
    .where(
      and(eq(attempts.testId, test.id), eq(attempts.status, "in_progress")),
    );
  if (total > 0) {
    throw AppError.conflict(
      "Published test has attempts in progress and cannot be modified",
    );
  }
}
