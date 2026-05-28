CREATE TYPE "public"."access_mode" AS ENUM('open', 'invite');--> statement-breakpoint
CREATE TABLE "test_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_invites_test_email_unique" UNIQUE("test_id","email")
);
--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "session_token_hash" text;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "access_token" text;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "access_mode" "access_mode" DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "test_invites" ADD CONSTRAINT "test_invites_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_access_token_unique" UNIQUE("access_token");