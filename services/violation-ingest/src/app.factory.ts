import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { config } from "./config.js";

/**
 * Builds the violation-ingest NestJS app without listening — used by both the
 * server entrypoint and the test suite (which drives it via supertest).
 * The global guard (throttler) and exception filter are wired in AppModule.
 */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    logger: config.NODE_ENV === "test" ? false : ["error", "warn", "log"],
  });
  return app;
}
