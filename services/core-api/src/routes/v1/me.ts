import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";

/**
 * Returns the identity of the API key making the request — a simple
 * authenticated endpoint useful for verifying credentials. Auth is enforced by
 * the global `/v1` onRequest hook (see plugins/auth.ts), so `request.apiKey` is
 * guaranteed to be set here.
 */
export const meRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/me",
    {
      schema: {
        tags: ["auth"],
        summary: "Identity of the authenticated API key",
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            id: Type.String({ format: "uuid" }),
            name: Type.String(),
          }),
          401: Type.Ref("ErrorResponse"),
        },
      },
    },
    async (request) => {
      // Non-null: the /v1 auth hook rejects unauthenticated requests upstream.
      const apiKey = request.apiKey!;
      return { id: apiKey.id, name: apiKey.name };
    },
  );
};
