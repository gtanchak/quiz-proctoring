CREATE TABLE "responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"selected_option_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"awarded_points" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "responses_attempt_question_unique" UNIQUE("attempt_id","question_id")
);
--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "score" real;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "max_score" real;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "graded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;