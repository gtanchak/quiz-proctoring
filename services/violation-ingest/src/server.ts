import { createApp } from "./app.factory.js";
import { config } from "./config.js";

async function bootstrap(): Promise<void> {
  const app = await createApp();
  await app.listen(config.PORT, config.HOST);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
