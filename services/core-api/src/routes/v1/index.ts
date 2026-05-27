import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { meRoutes } from "./me.js";

/**
 * The versioned API surface (`/v1`). Authentication for everything here is
 * enforced by the global onRequest hook in plugins/auth.ts. Resource routes
 * (tests, attempts, …) are registered alongside `me` in Phase C.
 */
export const v1Routes: FastifyPluginAsyncTypebox = async (app) => {
  app.register(meRoutes);
};
