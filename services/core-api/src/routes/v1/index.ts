import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { attemptsRoutes } from "./attempts.js";
import { meRoutes } from "./me.js";
import { testsRoutes } from "./tests.js";

/**
 * The versioned API surface (`/v1`). Authentication for everything here is
 * enforced by the global onRequest hook in plugins/auth.ts.
 */
export const v1Routes: FastifyPluginAsyncTypebox = async (app) => {
  app.register(meRoutes);
  app.register(testsRoutes);
  app.register(attemptsRoutes);
};
