import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { attemptsRoutes } from "./attempts.js";
import { invitesRoutes } from "./invites.js";
import { meRoutes } from "./me.js";
import { publicRoutes } from "./public.js";
import { questionsRoutes } from "./questions.js";
import { testsRoutes } from "./tests.js";

/**
 * The versioned API surface (`/v1`). Admin routes are authenticated by the
 * global onRequest hook in plugins/auth.ts; the candidate-facing `publicRoutes`
 * (`/v1/public/*`) are excluded from it and authenticate candidates themselves.
 */
export const v1Routes: FastifyPluginAsyncTypebox = async (app) => {
  app.register(meRoutes);
  app.register(testsRoutes);
  app.register(questionsRoutes);
  app.register(invitesRoutes);
  app.register(attemptsRoutes);
  app.register(publicRoutes);
};
