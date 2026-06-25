CREATE TYPE "public"."session_phase" AS ENUM('intro', 'items', 'wrap_up', 'complete');--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "phase" "session_phase" DEFAULT 'intro' NOT NULL;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "consent_at" timestamp with time zone;--> statement-breakpoint
UPDATE "attempts" SET "phase" = 'complete' WHERE "status" <> 'in_progress';
