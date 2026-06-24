import { createApp } from "./app.factory.js";
import { config } from "./config.js";

/**
 * Process entry point. Builds the app and starts listening. Boot failures are
 * fatal — exit non-zero so the orchestrator restarts us rather than serving a
 * half-initialised process.
 */
async function bootstrap(): Promise<void> {
  const app = await createApp();
  await app.listen(config.PORT, config.HOST);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
