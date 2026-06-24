import { Controller, Get } from "@nestjs/common";
import { type MeResponse } from "@proctoring/shared";
import { eq } from "drizzle-orm";
import { Auth } from "../auth/auth.decorator.js";
import type { RequestAuth } from "../auth/request-auth.js";
import { db } from "../db/client.js";
import { users } from "../db/schema/accounts.js";
import { apiKeys } from "../db/schema/api-keys.js";
import { AppError } from "../lib/errors.js";
import { serializeUser } from "../lib/serialize-account.js";

/**
 * Returns the identity of the authenticated actor — either a logged-in user
 * (full profile) or a machine API key (id + name). Auth is enforced by the
 * global {@link AuthGuard}, so `auth` is guaranteed to be set here.
 */
@Controller("v1")
export class MeController {
  @Get("me")
  async me(@Auth() auth: RequestAuth): Promise<MeResponse> {
    if (auth.actorType === "user") {
      const [row] = await db
        .select()
        .from(users)
        .where(eq(users.id, auth.userId!))
        .limit(1);
      if (!row) {
        throw AppError.unauthorized();
      }
      return { actorType: "user", orgId: auth.orgId, user: serializeUser(row) };
    }

    const [row] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, auth.apiKeyId!))
      .limit(1);
    if (!row) {
      throw AppError.unauthorized();
    }
    return {
      actorType: "apiKey",
      orgId: auth.orgId,
      apiKey: { id: row.id, name: row.name },
    };
  }
}
