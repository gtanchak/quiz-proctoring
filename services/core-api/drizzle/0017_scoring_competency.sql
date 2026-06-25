ALTER TABLE "questions" ADD COLUMN "competency" text;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "recommendation_override" text;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "recommendation_note" text;
