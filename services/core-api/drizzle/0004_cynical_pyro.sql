CREATE TYPE "public"."grading_mode" AS ENUM('all_or_nothing', 'partial');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('mcq_single', 'mcq_multiple');--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "type" "question_type" NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "options" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "correct_option_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "grading_mode" "grading_mode" DEFAULT 'all_or_nothing' NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "negative_marking" boolean DEFAULT false NOT NULL;