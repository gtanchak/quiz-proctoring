import { type MeResponse, MeResponseSchema } from "@proctoring/shared";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { users } from "../../db/schema/accounts.js";
import { apiKeys } from "../../db/schema/api-keys.js";
import { AppError } from "../../lib/errors.js";
import { serializeUser } from "../../lib/serialize-account.js";

/**
 * Returns the identity of the authenticated actor — either a logged-in user
 * (full profile) or a machine API key (id + name). Auth is enforced by the
 * global `/v1` onRequest hook (see plugins/auth.ts), so `request.auth` is
 * guaranteed to be set here.
 */
export const meRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/me",
    {
      schema: {
        tags: ["auth"],
        summary: "Identity of the authenticated actor (user session or API key)",
        security: [{ bearerAuth: [] }],
        response: {
          200: MeResponseSchema,
          401: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request): Promise<MeResponse> => {
      const auth = request.auth!;

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
    },
  );
};
