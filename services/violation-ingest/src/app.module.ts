import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuthService } from "./auth.service.js";
import { config } from "./config.js";
import { HealthController } from "./health.controller.js";
import { AllExceptionsFilter } from "./lib/all-exceptions.filter.js";
import { AttemptThrottlerGuard } from "./throttler.guard.js";
import { ViolationsController } from "./violations/violations.controller.js";
import { ViolationsService } from "./violations/violations.service.js";

/**
 * The violation-ingest application module. Deliberately lean — this is the
 * write-heavy exam-day hot path, isolated from core-api so a flood of events
 * never slows test-taking. A throttler guard provides backpressure ahead of
 * every handler; a single exception filter renders the shared error envelope.
 */
@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [
        { ttl: config.RATE_LIMIT_TTL_MS, limit: config.RATE_LIMIT_MAX },
      ],
    }),
  ],
  controllers: [HealthController, ViolationsController],
  providers: [
    AuthService,
    ViolationsService,
    { provide: APP_GUARD, useClass: AttemptThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
