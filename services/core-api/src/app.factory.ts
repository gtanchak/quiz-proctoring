import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";
import { config } from "./config.js";

/** OpenAPI document config — the source for the spec and the `/docs` UI. */
export function openApiConfig() {
  return new DocumentBuilder()
    .setTitle("Proctoring Core API")
    .setDescription(
      "Tests, attempts, users, and the public REST API. Authoritative for the test timer.",
    )
    .setVersion("0.0.0")
    .addBearerAuth({
      type: "http",
      scheme: "bearer",
      description:
        "`Authorization: Bearer <token>` — either an API key (`proct_…`) or a user session token (`sess_…`).",
    })
    .build();
}

/**
 * Builds the core-api NestJS app without listening — used by both the server
 * entrypoint and the test suite (which drives it via supertest). Global guards
 * and the exception filter are wired in {@link AppModule}; the OpenAPI spec and
 * Swagger UI (`/docs`) are mounted here.
 */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    logger: config.NODE_ENV === "test" ? false : ["error", "warn", "log"],
  });
  const document = SwaggerModule.createDocument(app, openApiConfig());
  SwaggerModule.setup("docs", app, document);
  return app;
}
