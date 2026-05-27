import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { SHARED_CONTRACT_VERSION } from "@proctoring/shared";

/**
 * Liveness check. Intentionally unversioned (lives at /health, not /v1/health)
 * and does not touch the database — it must answer even when dependencies are
 * degraded, so load balancers and probes get a fast, dependency-free signal.
 */
export const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        tags: ["system"],
        summary: "Liveness check",
        response: {
          200: Type.Object({
            status: Type.Literal("ok"),
            service: Type.Literal("core-api"),
            sharedContract: Type.String(),
            uptime: Type.Number(),
          }),
        },
      },
    },
    async () => ({
      status: "ok" as const,
      service: "core-api" as const,
      sharedContract: SHARED_CONTRACT_VERSION,
      uptime: process.uptime(),
    }),
  );
};
