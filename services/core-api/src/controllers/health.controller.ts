import { Controller, Get } from "@nestjs/common";
import { SHARED_CONTRACT_VERSION } from "@proctoring/shared";

/**
 * Liveness check. Intentionally unversioned (at /health, not /v1/health) and
 * does not touch the database — it must answer even when dependencies are
 * degraded, so load balancers and probes get a fast, dependency-free signal.
 */
@Controller()
export class HealthController {
  @Get("health")
  health() {
    return {
      status: "ok" as const,
      service: "core-api" as const,
      sharedContract: SHARED_CONTRACT_VERSION,
      uptime: process.uptime(),
    };
  }
}
