import { buildApp } from "./app.js";
import { config } from "./config.js";

/**
 * Process entry point. Builds the app and starts listening. Boot failures are
 * fatal — exit non-zero so the orchestrator restarts us rather than serving a
 * half-initialised process.
 */
const app = buildApp();

app.listen({ port: config.PORT, host: config.HOST }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
