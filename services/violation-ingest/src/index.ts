import Fastify from "fastify";
import {
  sharedPackageName,
  SHARED_CONTRACT_VERSION,
} from "@proctoring/shared";

/**
 * violation-ingest — PRO-46 skeleton. A minimal Fastify app exposing only a
 * health check. This service is deliberately isolated from core-api: a spike
 * in violation traffic must never slow down test-taking or the dashboard. The
 * real ingest endpoint (validating events against the PRO-50 schema) comes in
 * PRO-25.
 */
const app = Fastify({ logger: true });

app.get("/health", async () => ({
  status: "ok",
  service: "violation-ingest",
  sharedContract: {
    name: sharedPackageName,
    version: SHARED_CONTRACT_VERSION,
  },
}));

const port = Number(process.env.PORT ?? 3002);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
