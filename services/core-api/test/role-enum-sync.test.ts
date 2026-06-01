import { ROLES } from "@proctoring/shared";
import { describe, expect, it } from "vitest";
import { userRole } from "../src/db/schema/accounts.js";

/**
 * The `user_role` Postgres enum is defined with inline literals in accounts.ts
 * (drizzle-kit can't resolve the workspace import). This guards that those
 * literals stay identical to the `ROLES` contract in @proctoring/shared.
 */
describe("role enum sync", () => {
  it("matches the shared ROLES contract", () => {
    expect([...userRole.enumValues]).toEqual([...ROLES]);
  });
});
