CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"points" integer DEFAULT 1 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "instructions" text;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "available_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "available_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "max_attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "pass_mark" integer;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "negative_marking" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;