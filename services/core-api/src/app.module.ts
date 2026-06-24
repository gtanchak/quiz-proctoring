import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuthGuard } from "./auth/auth.guard.js";
import { RolesGuard } from "./auth/roles.guard.js";
import { TenantGuard } from "./auth/tenant.guard.js";
import { ActorThrottlerGuard } from "./auth/throttler.guard.js";
import { config } from "./config.js";
import { AttemptsController } from "./controllers/attempts.controller.js";
import { AuthController } from "./controllers/auth.controller.js";
import { EvidenceController } from "./controllers/evidence.controller.js";
import { HealthController } from "./controllers/health.controller.js";
import { InvitesController } from "./controllers/invites.controller.js";
import { MeController } from "./controllers/me.controller.js";
import { OrgController } from "./controllers/org.controller.js";
import { PublicController } from "./controllers/public.controller.js";
import { QuestionsController } from "./controllers/questions.controller.js";
import { ReportsController } from "./controllers/reports.controller.js";
import { TestsController } from "./controllers/tests.controller.js";
import { AllExceptionsFilter } from "./lib/all-exceptions.filter.js";

/**
 * The core-api application module (PRO-56 NestJS migration). Global guards run
 * in registration order: {@link AuthGuard} authenticates `/v1` (populating
 * `request.auth`), {@link TenantGuard} resolves/enforces the tenant boundary
 * (PRO-57), the throttler keys backpressure off the identity, then
 * {@link RolesGuard} enforces `@Roles`/`@RequireWrite` metadata. A single
 * exception filter renders the shared machine-readable error envelope.
 */
@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [
        { ttl: config.RATE_LIMIT_TTL_MS, limit: config.RATE_LIMIT_MAX },
      ],
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    MeController,
    OrgController,
    TestsController,
    QuestionsController,
    InvitesController,
    AttemptsController,
    ReportsController,
    EvidenceController,
    PublicController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: ActorThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
