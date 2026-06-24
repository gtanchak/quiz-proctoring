ALTER TYPE "public"."user_role" RENAME VALUE 'owner' TO 'tenant_admin';--> statement-breakpoint
ALTER TYPE "public"."user_role" RENAME VALUE 'admin' TO 'recruiter';--> statement-breakpoint
ALTER TYPE "public"."user_role" RENAME VALUE 'viewer' TO 'reviewer';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'platform_admin' BEFORE 'tenant_admin';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'candidate' AFTER 'reviewer';
