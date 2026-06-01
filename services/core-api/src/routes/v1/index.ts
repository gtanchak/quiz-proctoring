import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { attemptsRoutes } from "./attempts.js";
import { authRoutes } from "./auth.js";
import { invitesRoutes } from "./invites.js";
import { meRoutes } from "./me.js";
import { orgRoutes } from "./org.js";
import { publicRoutes } from "./public.js";
import { questionsRoutes } from "./questions.js";
import { testsRoutes } from "./tests.js";

/**
 * The versioned API surface (`/v1`). Most admin routes are authenticated by the
 * global onRequest hook in plugins/auth.ts. Two route groups are excluded from
 * it and authenticate themselves: the candidate-facing `publicRoutes`
 * (`/v1/public/*`) and the account `authRoutes` (`/v1/auth/*`, open or
 * session-guarded per-route).
 */
export const v1Routes: FastifyPluginAsyncTypebox = async (app) => {
  app.register(authRoutes);
  app.register(meRoutes);
  app.register(orgRoutes);
  app.register(testsRoutes);
  app.register(questionsRoutes);
  app.register(invitesRoutes);
  app.register(attemptsRoutes);
  app.register(publicRoutes);
};
