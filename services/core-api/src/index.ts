import Fastify from "fastify";
import {
  sharedPackageName,
  SHARED_CONTRACT_VERSION,
} from "@proctoring/shared";

/**
 * core-api — PRO-46 skeleton. A minimal Fastify app exposing only a health
 * check. Importing from @proctoring/shared here proves the shared contract is
 * consumable (and type-checks) from a backend service. Real routes (tests,
 * attempts, users, the server-authoritative timer) come in later issues.
 */
const app = Fastify({ logger: true });

app.get("/health", async () => ({
  status: "ok",
  service: "core-api",
  sharedContract: {
    name: sharedPackageName,
    version: SHARED_CONTRACT_VERSION,
  },
}));

const port = Number(process.env.PORT ?? 3001);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
