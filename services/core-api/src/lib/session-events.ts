import type { SessionPhase } from "@proctoring/shared";
import { db } from "../db/client.js";
import { sessionEvents } from "../db/schema/tests.js";

/**
 * Append a per-turn event to an attempt's session transcript (PRO-59, FR-23).
 * Awaited (not fire-and-forget) so the transcript is a reliable record — the
 * AI agent (P2) will append and later read its turns from here. Keep `data`
 * free of secrets/PII (CLAUDE.md §6): ids, counts, and stable codes only.
 */
export async function recordSessionEvent(
  attemptId: string,
  type: string,
  opts: { phase?: SessionPhase | null; data?: Record<string, unknown> } = {},
): Promise<void> {
  await db.insert(sessionEvents).values({
    attemptId,
    type,
    phase: opts.phase ?? null,
    data: opts.data ?? {},
  });
}
