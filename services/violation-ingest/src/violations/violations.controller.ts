import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
} from "@nestjs/common";
import { ViolationsService } from "./violations.service.js";

/**
 * Thin controller for the violation write hot path + reporting read API.
 * All logic (auth, validation, persistence) lives in {@link ViolationsService}.
 */
@Controller("v1")
export class ViolationsController {
  constructor(private readonly violations: ViolationsService) {}

  @Post("violations")
  @HttpCode(200)
  ingest(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    return this.violations.ingest(authorization, body);
  }

  @Get("violations")
  list(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: Record<string, unknown>,
  ) {
    return this.violations.list(authorization, query);
  }
}
